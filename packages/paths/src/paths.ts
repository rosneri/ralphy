import { exists } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/**
 * Walk up from cwd looking for an `openspec/` directory.
 * Falls back to cwd if not found.
 */
export async function findProjectRoot(): Promise<string> {
  let dir = process.cwd();
  while (dir !== "/") {
    if (await exists(join(dir, "openspec"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

/**
 * Default location for git worktrees managed by ralphy.
 */
export function worktreesDir(projectRoot: string): string {
  return join(homedir(), ".ralph", basename(projectRoot), "worktrees");
}
