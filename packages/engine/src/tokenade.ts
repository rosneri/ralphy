/**
 * Tokenade (https://tokenade.net) integration — the parts Ralphy drives itself.
 *
 * Tokenade is a local-first CLI that compacts what a coding agent sends to the
 * model: command output, MCP tool manifests, file reads. It does that through
 * hooks it installs into the agent's own config (`tokenade install` writes into
 * `~/.claude/settings.json`), so a globally installed Tokenade already optimizes
 * every `claude` / `codex` process Ralphy spawns — Ralphy performs no
 * compaction of its own and this module never sits in the token path.
 *
 * What Ralphy adds on top is the two things Tokenade cannot do for itself in a
 * long-lived, worktree-per-task agent:
 *
 *  - **Preflight** (`./preflight/tokenade`) — confirm the CLI is installed and
 *    licensed BEFORE a multi-hour run burns tokens unoptimized, instead of
 *    discovering it from a surprising bill.
 *  - **Index warm** — every task runs in a fresh `git worktree`, which is a
 *    fresh directory with a cold Tokenade index. Warming it once at worktree
 *    provisioning keeps the first iterations off the full-read path.
 *
 * Everything here is best-effort by construction: Tokenade being absent, stale,
 * or slow degrades the run to "unoptimized", never to "failed".
 */
import { spawn } from "./spawn";

/** How aggressively Tokenade folds file reads (`TOKENADE_READ_MODE`). */
export type TokenadeReadMode = "aggressive" | "task" | "reference" | "entropy";

/** The resolved `tokenade` block of WORKFLOW.md, as this package consumes it.
 *  Structurally compatible with `WorkflowConfig["tokenade"]`; declared locally
 *  so `@ralphy/engine` does not depend on `@ralphy/workflow`. */
export interface TokenadeSettings {
  enabled: boolean;
  required: boolean;
  indexWorktrees: boolean;
  readMode?: TokenadeReadMode | undefined;
}

/** Indexing a large repo is slow but bounded; past this the warm is abandoned
 *  and the worker starts anyway on a cold index. */
const INDEX_TIMEOUT_MS = 180_000;

/**
 * Environment variables Tokenade reads out of the process environment. Pure —
 * returns what to set rather than setting it, so the mapping is testable
 * without touching `process.env`.
 *
 * Empty when Tokenade is disabled: there is deliberately no "force off" value.
 * The CLI exposes no per-process kill switch, so `enabled: false` means Ralphy
 * stays out of the way rather than pretending it can disable a Tokenade the
 * user installed globally.
 */
export function tokenadeEnvironment(settings: TokenadeSettings): Record<string, string> {
  if (!settings.enabled || settings.readMode === undefined) return {};
  return { TOKENADE_READ_MODE: settings.readMode };
}

/**
 * Publish {@link tokenadeEnvironment} onto this process's environment so every
 * descendant inherits it.
 *
 * Engine spawns copy `process.env` at spawn time (see `scrubClaudeEnv`), so
 * setting these once at boot reaches every engine process, worker, and hook
 * without threading a read-mode parameter through the whole request chain.
 * Call once, right after config resolution.
 */
export function applyTokenadeEnvironment(settings: TokenadeSettings): void {
  for (const [key, value] of Object.entries(tokenadeEnvironment(settings))) {
    process.env[key] = value;
  }
}

export interface WarmIndexResult {
  /** True only when `tokenade index` ran and exited 0. */
  indexed: boolean;
  /** Why the index was skipped or how it failed — null on success and on a
   *  deliberate skip (disabled / not requested), which callers do not log. */
  message: string | null;
}

/**
 * Build Tokenade's symbol index for a freshly provisioned worktree.
 *
 * Best-effort by contract: a missing binary, a non-zero exit, or a timeout all
 * resolve to `indexed: false` with a message for the caller to log at warning
 * level. Nothing here throws, and nothing here blocks the worker.
 */
export async function warmTokenadeIndex(
  cwd: string,
  settings: TokenadeSettings,
): Promise<WarmIndexResult> {
  if (!settings.enabled || !settings.indexWorktrees) {
    return { indexed: false, message: null };
  }
  try {
    const proc = spawn({
      cmd: ["tokenade", "index"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return {
        indexed: false,
        message: `tokenade index exited ${exitCode} in ${cwd} — the worker starts on a cold index`,
      };
    }
    return { indexed: true, message: null };
  } catch (err) {
    return {
      indexed: false,
      message: `tokenade index could not run in ${cwd}: ${(err as Error).message}`,
    };
  }
}
