import type { CmdRunner } from "../../agent/pr";

export interface RawCheck {
  status?: string;
  conclusion?: string;
  state?: string;
  name?: string;
  context?: string;
}

const TRANSIENT_GH_RE =
  /HTTP 5\d\d|Gateway Timeout|Bad Gateway|Service Unavailable|connection reset|ECONNRESET|ETIMEDOUT|getaddrinfo|EAI_AGAIN|could not resolve host/i;

/** gh exits 1 with this message when no workflows are configured for a branch. */
export const NO_CHECKS_RE = /no checks reported/i;

/** gh exits 1 with a PARTIAL GraphQL error when the token cannot read some
 *  checks' commit-status contexts (e.g. a third-party integration posting a
 *  legacy StatusContext rather than a CheckRun) — but it still prints usable
 *  bucket JSON for every check it could read. */
export const PARTIAL_ACCESS_RE = /Resource not accessible by personal access token/i;

/** Backoff schedule for transient `gh` failures (ms). 5s / 15s / 45s. */
const GH_RETRY_DELAYS = [5_000, 15_000, 45_000];

/** Internal: run gh with retry on transient HTTP/network errors. */
export async function runGhWithRetry(
  cmd: string[],
  runner: CmdRunner,
  cwd: string,
  onRetry?: (attempt: number, delayMs: number, reason: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ stdout: string; stderr: string }> {
  let lastErr: unknown;
  for (let i = 0; i <= GH_RETRY_DELAYS.length; i++) {
    try {
      return await runner.run(cmd, cwd);
    } catch (err) {
      const e = err as Error & { stderr?: string; stdout?: string };
      const blob = `${e.message}\n${e.stderr ?? ""}\n${e.stdout ?? ""}`;
      if (!TRANSIENT_GH_RE.test(blob) || i === GH_RETRY_DELAYS.length) throw err;
      const delay = GH_RETRY_DELAYS[i]!;
      const firstLine = (e.stderr?.trim().split("\n")[0] ?? e.message).slice(0, 120);
      onRetry?.(i + 1, delay, firstLine);
      await sleep(delay);
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Classify a single check from `gh pr view --json statusCheckRollup` into
 * our 4-bucket model.
 *
 * GitHub Actions checks have `status` + `conclusion`; legacy commit statuses
 * have `state` only.
 */
export function classifyCheck(c: RawCheck): "pass" | "fail" | "pending" | "skip" {
  const status = (c.status ?? "").toUpperCase();
  const conclusion = (c.conclusion ?? "").toUpperCase();
  const state = (c.state ?? "").toUpperCase();

  // GitHub Actions: non-COMPLETED status means still running
  if (status && status !== "COMPLETED") return "pending";

  // Legacy commit statuses
  if (state === "PENDING" || state === "EXPECTED") return "pending";

  const settled = conclusion || state;
  if (settled === "SKIPPED") return "skip";
  if (
    settled === "FAILURE" ||
    settled === "TIMED_OUT" ||
    settled === "CANCELLED" ||
    settled === "ERROR"
  )
    return "fail";

  // SUCCESS / NEUTRAL / and anything else settled — treat as pass
  return "pass";
}

/**
 * Map a `gh pr checks` bucket string (from `--json bucket`) into our
 * 4-bucket model.
 */
export function classifyGhBucket(bucket: string): "pass" | "fail" | "pending" | "skip" {
  if (bucket === "fail" || bucket === "cancel") return "fail";
  if (bucket === "skipping") return "skip";
  if (bucket === "pending") return "pending";
  return "pass";
}
