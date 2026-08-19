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

/** Where the Tokenade CLI Ralphy invokes came from. Surfaced in messages so a
 *  failure says which copy failed. */
export type TokenadeSource = "bundled" | "path";

export interface TokenadeCommand {
  /** argv prefix that invokes the CLI; append the subcommand and its flags. */
  command: string[];
  source: TokenadeSource;
}

/** Resolves a module specifier to a filesystem path, or throws when absent.
 *  Injectable so the resolution branches are testable without a real install. */
export type ModuleResolver = (specifier: string) => string;

/** Tokenade ships its launcher at a stable path and declares no `exports` map,
 *  so this subpath resolves under normal node resolution. */
const BUNDLED_LAUNCHER = "@tokenade/cli/bin/tokenade.js";

const resolveFromHere: ModuleResolver = (specifier) => Bun.resolveSync(specifier, import.meta.dir);

/**
 * Locate the Tokenade CLI.
 *
 * Ralphy declares `@tokenade/cli` as an optional dependency, so installing
 * Ralphy installs Tokenade too. But npm only links the *top-level* package's
 * `bin` entries onto `PATH` — a dependency's `tokenade` bin is not on `PATH`,
 * so it has to be resolved through node resolution instead of assumed.
 *
 * The bundled copy wins because it is version-locked to this Ralphy and is
 * present on a plain `npm i -g @neriros/ralphy`. `PATH` is the fallback, which
 * covers a separate global `npm i -g @tokenade/cli` and the case where the
 * optional dependency was skipped (`--no-optional`, an unsupported platform).
 *
 * The launcher is invoked through the current runtime (`process.execPath`)
 * rather than executed directly: that needs neither an exec bit on the file nor
 * a `node` on `PATH`, and it works on Windows, where a bare `.js` path is not
 * executable.
 */
export function resolveTokenadeCommand(resolve: ModuleResolver = resolveFromHere): TokenadeCommand {
  try {
    return { command: [process.execPath, resolve(BUNDLED_LAUNCHER)], source: "bundled" };
  } catch {
    return { command: ["tokenade"], source: "path" };
  }
}

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
      cmd: [...resolveTokenadeCommand().command, "index"],
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

/**
 * Run an arbitrary Tokenade subcommand with the terminal attached, and return
 * its exit code — the engine behind `ralphy tokenade …`.
 *
 * Without this, the bundled copy would be unreachable: Tokenade's own setup
 * (`tokenade install`, `tokenade login`) has to be run by a human, and a
 * dependency's bin is not on `PATH`.
 */
export async function runTokenadePassthrough(args: string[]): Promise<number> {
  const { command, source } = resolveTokenadeCommand();
  try {
    const proc = spawn({
      cmd: [...command, ...args],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await proc.exited;
  } catch (err) {
    const where = source === "bundled" ? "the copy bundled with Ralphy" : "`tokenade` on PATH";
    process.stderr.write(`Could not run ${where}: ${(err as Error).message}\n`);
    return 1;
  }
}
