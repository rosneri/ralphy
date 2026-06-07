import type { CmdRunner } from "./pr";
import { classifyGhBucket, NO_CHECKS_RE, runGhWithRetry } from "../shared/pr/ci-classify";

const PR_CHECKS_FIELDS = "name,bucket,link,workflow,event";

interface CiStatus {
  bucket: "pass" | "fail" | "pending";
  /** Workflow run IDs of failing checks (only populated when bucket is "fail"). */
  failedRunIds: string[];
  /** Names of failing checks (only populated when bucket is "fail"). */
  failedCheckNames: string[];
}

/**
 * Resolve the status of a PR's CI checks.
 *
 * - "pending" if any check is still in progress
 * - "fail"    if every non-pending check has settled and at least one failed
 * - "pass"    if every check passed
 *
 * `failedRunIds` extracts numeric workflow-run IDs from each failing
 * check's `link` field (e.g. ".../actions/runs/12345/job/9876" → "12345").
 *
 * Transient HTTP 5xx / network failures from `gh` are retried with
 * backoff (5s/15s/45s) — a single GitHub blip should not abort the
 * watch loop.
 */
export async function getPrChecksStatus(
  prRef: string,
  runner: CmdRunner,
  cwd: string,
  onTransientRetry?: (attempt: number, delayMs: number, reason: string) => void,
  ignoreCiChecks: string[] = [],
): Promise<CiStatus> {
  let out: { stdout: string; stderr: string };
  try {
    out = await runGhWithRetry(
      ["gh", "pr", "checks", prRef, "--json", PR_CHECKS_FIELDS],
      runner,
      cwd,
      onTransientRetry,
    );
  } catch (err) {
    const e = err as Error & { stderr?: string; stdout?: string };
    const blob = `${e.message}\n${e.stderr ?? ""}\n${e.stdout ?? ""}`;
    // gh exits 1 with "no checks reported" when the repo has no CI workflows.
    // Treat this as a pass — no checks configured means nothing can fail.
    if (NO_CHECKS_RE.test(blob)) return { bucket: "pass", failedRunIds: [], failedCheckNames: [] };
    throw err;
  }
  const ignoredLower = ignoreCiChecks.map((n) => n.toLowerCase());
  const checks = (
    JSON.parse(out.stdout || "[]") as {
      name: string;
      bucket: string;
      link?: string;
    }[]
  )
    .filter((c) => !ignoredLower.includes(c.name.toLowerCase()))
    .filter((c) => classifyGhBucket(c.bucket) !== "skip");

  if (checks.some((c) => classifyGhBucket(c.bucket) === "pending")) {
    return { bucket: "pending", failedRunIds: [], failedCheckNames: [] };
  }
  const failed = checks.filter((c) => classifyGhBucket(c.bucket) === "fail");
  if (failed.length === 0) return { bucket: "pass", failedRunIds: [], failedCheckNames: [] };

  const ids = new Set<string>();
  for (const c of failed) {
    const m = c.link?.match(/\/actions\/runs\/(\d+)/);
    if (m) ids.add(m[1]!);
  }
  return { bucket: "fail", failedRunIds: [...ids], failedCheckNames: failed.map((c) => c.name) };
}

/** Fetch the failure logs for a set of workflow runs, truncated. */
export async function fetchFailedRunLogs(
  runIds: string[],
  runner: CmdRunner,
  cwd: string,
  maxCharsPerRun = 4000,
): Promise<string> {
  const chunks: string[] = [];
  for (const id of runIds) {
    try {
      const r = await runner.run(["gh", "run", "view", id, "--log-failed"], cwd);
      const text = r.stdout.trim();
      const truncated =
        text.length > maxCharsPerRun
          ? text.slice(0, maxCharsPerRun) + `\n…[truncated ${text.length - maxCharsPerRun} chars]`
          : text;
      chunks.push(`--- run ${id} ---\n${truncated}`);
    } catch (err) {
      chunks.push(`--- run ${id} ---\n(failed to fetch logs: ${(err as Error).message})`);
    }
  }
  return chunks.join("\n\n");
}
