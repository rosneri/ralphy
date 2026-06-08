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

/** Upper bound on an honored `Retry-After` hint — clamps a hostile/huge value
 *  (mirrors `MAX_RETRY_AFTER_MS` in `linear-client.ts`). */
export const MAX_GH_RETRY_AFTER_MS = 60_000;

const RETRY_AFTER_RE = /retry-?after[:\s]+([^\n\r]+)/i;
const TRY_AGAIN_RE = /try again in (\d+)\s*seconds?/i;

/**
 * Parse a `Retry-After` / `retry-after` hint (seconds or HTTP-date) out of a
 * `gh` failure's stderr/message and return it in milliseconds. Falls back to a
 * `try again in N seconds` phrasing GitHub sometimes emits. Returns undefined
 * when no parseable hint is present (caller then uses exponential backoff).
 */
export function parseGhRetryAfter(err: unknown): number | undefined {
  const e = (err ?? {}) as GhError;
  const blob = `${e.message ?? ""}\n${e.stderr ?? ""}`;

  const header = RETRY_AFTER_RE.exec(blob);
  if (header) {
    const value = header[1]!.trim();
    const asNum = Number(value);
    if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
    const asDate = Date.parse(value);
    if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  }

  const tryAgain = TRY_AGAIN_RE.exec(blob);
  if (tryAgain) return Math.max(0, Number(tryAgain[1]) * 1000);

  return undefined;
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

function expoBackoffMs(attempt: number): number {
  return Math.min(2000, 200 * 2 ** (attempt - 1));
}

const GH_RETRY: RetryPolicy = {
  maxAttempts: 3,
  isRetryable: isTransientGhError,
  // Honor a server `Retry-After` hint (clamped) when present, else fall back
  // to exponential backoff. Auth errors never reach here (non-retryable).
  delayMs: (attempt, err) =>
    Math.min(MAX_GH_RETRY_AFTER_MS, parseGhRetryAfter(err) ?? expoBackoffMs(attempt)),
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
