import { join } from "node:path";
import type { ProjectLayout } from "@ralphy/types";
import { getLayout } from "@ralphy/context";

export type { ProjectLayout } from "@ralphy/types";

const STATE_FILE = ".ralph-state.json";

/**
 * Sidecar file (sibling to `.ralph-state.json` in `taskStateDir`) holding the
 * durable per-change give-up tally as a single integer. Kept OUT of
 * `.ralph-state.json` on purpose: that file has multiple async read-modify-write
 * writers (loop, confirmation gate), so a second writer would clobber concurrent
 * updates. The sidecar has exactly one writer — `recordGaveUp` at worker exit —
 * which never overlaps itself (one worker per change), so it needs no locking.
 */
export const GAVEUP_COUNT_FILE = ".ralph-gaveup-count";

export function projectLayout(root: string): ProjectLayout {
  const statesDir = join(root, ".ralph", "tasks");
  const tasksDir = join(root, "openspec", "changes");
  return {
    root,
    statesDir,
    tasksDir,
    agentStateFile: join(root, ".ralph", "agent-state.json"),
    changeDir: (name) => join(tasksDir, name),
    taskStateDir: (name) => join(statesDir, name),
    stateFile: (name) => join(statesDir, name, STATE_FILE),
  };
}

/** Get the current ProjectLayout from context. Throws if not set. */
export function layoutFromContext(): ProjectLayout {
  return getLayout();
}
