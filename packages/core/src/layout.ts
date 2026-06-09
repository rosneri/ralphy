import { join } from "node:path";
import type { ProjectLayout } from "@ralphy/types";
import { getLayout } from "@ralphy/context";

export type { ProjectLayout } from "@ralphy/types";

const STATE_FILE = ".ralph-state.json";

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
