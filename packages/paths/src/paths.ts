import { exists } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/**
 * Markers that identify a ralphy project root. `WORKFLOW.md` is the config file
 * the user authors; `openspec/` is the scaffold ralphy creates. Either one marks
 * the root — they are kept decoupled because `WORKFLOW.md` may exist before
 * `openspec` is scaffolded, and both must resolve to the SAME directory or the
 * config gets looked-for / created in the wrong place.
 *
 * The `"WORKFLOW.md"` literal is duplicated from `@ralphy/workflow`'s
 * `WORKFLOW_FILE` on purpose: `paths` is a leaf package and importing `workflow`
 * just for the constant would add a dependency edge for a stable filename.
 */
const ROOT_MARKERS = ["WORKFLOW.md", "openspec"] as const;

/**
 * Walk up from `startDir` (cwd by default) looking for a ralphy project root —
 * the nearest ancestor containing `WORKFLOW.md` or an `openspec/` directory.
 * Falls back to `startDir` when no marker is found.
 */
export async function findProjectRoot(startDir: string = process.cwd()): Promise<string> {
  let dir = startDir;
  while (dir !== "/") {
    for (const marker of ROOT_MARKERS) {
      if (await exists(join(dir, marker))) return dir;
    }
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
