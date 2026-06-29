import { join } from "node:path";

const GIT_LOCAL_TIMEOUT_MS = 30_000;
const GIT_NETWORK_TIMEOUT_MS = 60_000;

const NETWORK_CMDS = new Set(["push", "fetch", "pull", "clone", "ls-remote"]);

function runGit(args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const isNetwork = args.some((a) => NETWORK_CMDS.has(a));
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    stdout: "pipe",
    stderr: "pipe",
    timeout: isNetwork ? GIT_NETWORK_TIMEOUT_MS : GIT_LOCAL_TIMEOUT_MS,
  });
  const decoder = new TextDecoder();
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout ? decoder.decode(proc.stdout) : "",
    stderr: proc.stderr ? decoder.decode(proc.stderr) : "",
  };
}

/**
 * Get the current git branch name.
 */
export function getCurrentBranch(): string {
  const result = runGit(["branch", "--show-current"]);
  if (result.exitCode !== 0) return "main";
  return result.stdout.trim() || "main";
}

/**
 * Stage files for commit.
 */
export function gitAdd(files: string[]): void {
  const result = runGit(["add", ...files]);
  if (result.exitCode !== 0) {
    throw new Error("git add failed", { cause: { stderr: result.stderr.trim() } });
  }
}

/**
 * Create a git commit with the given message.
 */
export function gitCommit(message: string): void {
  const result = runGit(["commit", "-m", message]);
  if (result.exitCode !== 0) {
    throw new Error("git commit failed", { cause: { stderr: result.stderr.trim() } });
  }
}

/**
 * Push to remote with fallback chain:
 * 1. git push
 * 2. git push -u origin <branch>
 * 3. git push --set-upstream origin <branch>
 * If all fail, silently skip (no remote configured).
 */
export function gitPush(): void {
  const branch = getCurrentBranch();
  if (runGit(["push"]).exitCode === 0) return;
  if (runGit(["push", "-u", "origin", branch]).exitCode === 0) return;
  runGit(["push", "--set-upstream", "origin", branch]);
  // If all fail, silently skip (no remote configured)
}

/**
 * Commit the state.json file in a task directory with the given message.
 */
export function commitState(taskDir: string, message: string): void {
  const stateFile = join(taskDir, "state.json");
  try {
    gitAdd([stateFile]);
    gitCommit(`docs(ralph): ${message}`);
  } catch {
    // state file may not exist or nothing to commit
  }
}

/**
 * Return the parsed lines of `git status --porcelain` (one per uncommitted
 * file). Empty array = clean worktree. Used by the loop's archive guard to
 * refuse archiving a change when the worker exited with stranded work — see
 * LIT-303. Returns [] when git is unavailable or errors, so a missing git
 * binary doesn't permanently wedge the loop.
 */
export function getUncommittedFiles(): readonly string[] {
  const result = runGit(["status", "--porcelain"]);
  if (result.exitCode !== 0) return [];
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

/**
 * Path prefixes ralphy generates and owns inside a worktree. Changes confined
 * to these are framework artifacts, never worker output. `.ralph-hooks/` holds
 * the per-worktree pre-push hook that `installPrePushHook` re-writes on every
 * setup; when a repo has accidentally committed that file (so a self-ignoring
 * `.gitignore` can no longer hide it), it shows as a permanent ` M` entry. That
 * noise must not be mistaken for stranded work.
 */
const FRAMEWORK_OWNED_PATH_PREFIXES = [".ralph-hooks/"] as const;

/** Extract the worktree path from a single `git status --porcelain` line.
 *  Strips the two status columns + separating space, takes the destination side
 *  of a rename (`old -> new`), and unwraps git's quoting of special-char paths. */
function statusLinePath(statusLine: string): string {
  const body = statusLine.slice(3);
  const renameArrow = body.indexOf(" -> ");
  const path = renameArrow === -1 ? body : body.slice(renameArrow + 4);
  return path.replace(/^"|"$/g, "");
}

/**
 * Drop `git status --porcelain` lines that describe only framework-owned
 * artifacts (see {@link FRAMEWORK_OWNED_PATH_PREFIXES}). The archive guard
 * refuses to archive a change that still has leftover *worker* edits; a
 * tracked-and-rewritten pre-push hook is ralphy's own noise and must not wedge
 * the loop into an endless stranded → respawn livelock. See LIT-303.
 */
export function excludeFrameworkOwnedPaths(statusLines: readonly string[]): readonly string[] {
  return statusLines.filter((statusLine) => {
    const path = statusLinePath(statusLine);
    return !FRAMEWORK_OWNED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
  });
}

/**
 * Commit all files in a task directory (state.json + *.md) with the given message.
 */
export function commitTaskDir(taskDir: string, message: string): void {
  try {
    gitAdd([taskDir]);
    gitCommit(`docs(ralph): ${message}`);
  } catch {
    // nothing to commit
  }
}
