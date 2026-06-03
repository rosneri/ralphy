import { exists } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/**
 * The file that marks a ralphy project root: the `WORKFLOW.md` the user authors.
 *
 * The literal is duplicated from `@ralphy/workflow`'s `WORKFLOW_FILE` on purpose:
 * `paths` is a leaf package and importing `workflow` just for the constant would
 * add a dependency edge for a stable filename.
 */
const ROOT_MARKER = "WORKFLOW.md";

/**
 * Walk up from `startDir` (cwd by default) looking for the project root — the
 * nearest ancestor containing `WORKFLOW.md`. Falls back to `startDir` when no
 * `WORKFLOW.md` is found (e.g. a fresh project about to have one created).
 */
export async function findProjectRoot(startDir: string = process.cwd()): Promise<string> {
  let dir = startDir;
  while (dir !== "/") {
    if (await exists(join(dir, ROOT_MARKER))) return dir;
    dir = resolve(dir, "..");
  }
  return startDir;
}

/**
 * Default location for git worktrees managed by ralphy.
 */
export function worktreesDir(projectRoot: string): string {
  return join(homedir(), ".ralph", basename(projectRoot), "worktrees");
}

/**
 * Backup file for an in-progress `ralphy init` setup session. The wizard writes
 * answers here as the user advances so an accidental exit can be resumed; it is
 * removed once a WORKFLOW.md is successfully written.
 */
export function setupBackupPath(): string {
  return join(homedir(), ".ralph", "setup.tmp");
}
