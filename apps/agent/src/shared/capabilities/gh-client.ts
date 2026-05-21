/**
 * `gh` shared capability — wraps a single GitHub CLI invocation behind the
 * capability shell so every call gets uniform retry / error formatting /
 * bus telemetry.
 *
 * Retry policy: transient network / 5xx / rate-limit failures are retried
 * with a small backoff. Authentication errors (`HTTP 401/403`, "gh auth"
 * messages) are **never** retried — the credential will not heal itself.
 *
 * Error formatting: `exit code: <n> | <stderr tail>` so the bus payload is
 * actionable without dumping multi-kilobyte stdout/stderr blobs.
 *
 * The capability is non-required — callers decide how to handle a final
 * failure (silently degrade, surface to the user, etc.). The shell still
 * emits `.failed` and rethrows; callers that want to swallow wrap in
 * `try/catch`.
 */

import type { Capability, RetryPolicy } from "./types";
import type { CmdRunner } from "../../agent/pr";

interface GhRunArgs {
  runner: CmdRunner;
  cwd: string;
  /** Full argv to pass to `gh`, e.g. `["pr", "view", url, "--json", "state"]`. */
  args: string[];
}

interface GhResult {
  stdout: string;
  stderr: string;
}

interface GhError {
  message?: string;
  stderr?: string;
  stdout?: string;
  code?: number;
}

const STDERR_TAIL_CHARS = 512;
const AUTH_PATTERNS = [
  /HTTP\s*40[13]/i,
  /gh\s+auth/i,
  /not authenticated/i,
  /authentication\s+token/i,
  /Bad credentials/i,
];
const TRANSIENT_PATTERNS = [
  /HTTP\s*5\d\d/i,
  /rate limit/i,
  /timed?\s*out/i,
  /timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /network/i,
  /temporarily unavailable/i,
];

function tail(s: string | undefined, n: number): string {
  if (!s) return "";
  const t = s.length > n ? s.slice(s.length - n) : s;
  return t.trim();
}

export function formatGhError(err: unknown): string {
  const e = (err ?? {}) as GhError;
  const code = typeof e.code === "number" ? e.code : "?";
  const stderrTail = tail(e.stderr, STDERR_TAIL_CHARS);
  const base = `gh exited ${code}`;
  return stderrTail ? `${base}: ${stderrTail}` : e.message ? `${base}: ${e.message}` : base;
}

export function isAuthError(err: unknown): boolean {
  const e = (err ?? {}) as GhError;
  const blob = `${e.message ?? ""}\n${e.stderr ?? ""}`;
  return AUTH_PATTERNS.some((p) => p.test(blob));
}

export function isTransientGhError(err: unknown): boolean {
  if (isAuthError(err)) return false;
  const e = (err ?? {}) as GhError;
  const blob = `${e.message ?? ""}\n${e.stderr ?? ""}`;
  return TRANSIENT_PATTERNS.some((p) => p.test(blob));
}

const GH_RETRY: RetryPolicy = {
  maxAttempts: 3,
  isRetryable: isTransientGhError,
  delayMs: (attempt) => Math.min(2000, 200 * 2 ** (attempt - 1)),
};

export const gh: Capability<GhRunArgs, GhResult> = {
  name: "gh.cmd",
  required: false,
  retryPolicy: GH_RETRY,
  errorFormatter: formatGhError,
  run: ({ runner, cwd, args }) => runner.run(["gh", ...args], cwd),
};

/**
 * Factory for a named gh capability — use when a specific call site wants
 * its own bus event prefix (e.g. `gh.pr.view`) instead of the generic
 * `gh.cmd`. Behaviour is otherwise identical to `gh`.
 */
export function ghCapability(name: string): Capability<GhRunArgs, GhResult> {
  return { ...gh, name };
}
