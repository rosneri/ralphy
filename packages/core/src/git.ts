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
