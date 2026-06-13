/**
 * Detect completed-but-unarchived OpenSpec changes.
 *
 * A change is "stale" when its `tasks.md` is fully checked off (per
 * `allChecked`) yet it still lives under `openspec/changes/` instead of
 * `openspec/changes/archive/`. The auto-archive flow is supposed to move
 * these out; when it fails silently the backlog grows (RLF-251).
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { allChecked } from "../detections/tasks";

/**
 * Return the names of completed-but-unarchived changes under
 * `<cwd>/openspec/changes/`, excluding the `archive/` directory.
 *
 * A change with no `tasks.md`, an empty `tasks.md`, or any remaining
 * `- [ ]` item is NOT stale. A missing `openspec/changes/` directory
 * yields `[]` (mirrors `listChanges`' swallow-and-return-empty).
 */
export async function findStaleChanges(opts?: { cwd?: string }): Promise<string[]> {
  const cwd = opts?.cwd ?? process.cwd();
  const changesDir = join(cwd, "openspec", "changes");

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(changesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const stale: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "archive") continue;

    const tasksPath = join(changesDir, entry.name, "tasks.md");
    let content: string;
    try {
      content = await Bun.file(tasksPath).text();
    } catch {
      // No tasks.md → a half-created change dir, not "completed".
      continue;
    }
    if (allChecked(content)) {
      stale.push(entry.name);
    }
  }

  return stale;
}
