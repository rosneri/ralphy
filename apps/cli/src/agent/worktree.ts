import { join } from "node:path";

interface WorktreeHandle {
  /** Absolute path to the new working tree. */
  cwd: string;
  /** Branch name created for this worktree. */
  branch: string;
}

export interface GitRunner {
  /** Run a git command in the given cwd. Throws on non-zero exit with stderr in message. */
  run: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
}

/** Where worktrees live, relative to the project root. */
export function worktreesDir(projectRoot: string): string {
  return join(projectRoot, ".ralph", "worktrees");
}

/** Branch name used for a given change-name slug. */
export function branchForChange(changeName: string): string {
  return `ralph/${changeName}`;
}

/**
 * Create a new git worktree at `.ralph/worktrees/<changeName>` checked out
 * onto a fresh branch `ralph/<changeName>` rooted at the current HEAD of
 * `projectRoot`. Returns the absolute worktree path and branch name.
 *
 * If a worktree at that path already exists, it is reused (treated as
 * resume). If the branch already exists locally, it is checked out as-is.
 */
export async function createWorktree(
  projectRoot: string,
  changeName: string,
  runner: GitRunner,
): Promise<WorktreeHandle> {
  const dir = worktreesDir(projectRoot);
  const cwd = join(dir, changeName);
  const branch = branchForChange(changeName);

  // If the worktree directory already exists in git's worktree list, reuse it.
  const list = await runner.run(["worktree", "list", "--porcelain"], projectRoot);
  if (list.stdout.includes(`worktree ${cwd}\n`)) {
    return { cwd, branch };
  }

  // Does the branch already exist locally?
  let branchExists = true;
  try {
    await runner.run(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], projectRoot);
  } catch {
    branchExists = false;
  }

  const cmd = branchExists
    ? ["worktree", "add", cwd, branch]
    : ["worktree", "add", "-b", branch, cwd];
  await runner.run(cmd, projectRoot);
  return { cwd, branch };
}

/**
 * Remove a worktree (and prune any stale entries). Best-effort: a failure
 * here should not block higher-level cleanup, so callers typically swallow
 * the error and log instead.
 */
export async function removeWorktree(
  projectRoot: string,
  cwd: string,
  runner: GitRunner,
): Promise<void> {
  await runner.run(["worktree", "remove", "--force", cwd], projectRoot);
}
