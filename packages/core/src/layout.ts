import { join } from "node:path";

/**
 * Single source of truth for where Ralph's files live in a project (or
 * worktree) tree. Every path derivation goes through this module, so a
 * future relayout (e.g. moving `.ralph/tasks` elsewhere) is a one-file
 * change rather than a hunt-and-replace across the repo.
 *
 *  <root>/
 *    .ralph/
 *      agent-state.json                 ← orchestrator (one per project)
 *      tasks/
 *        <changeName>/
 *          .ralph-state.json             ← per-change loop state
 *    openspec/
 *      changes/
 *        <changeName>/
 *          proposal.md, tasks.md, …
 *
 * `root` may be the project root (regular `ralph task` runs) or a
 * worktree root (agent-mode runs with --worktree). The shape is
 * identical either way.
 */
export interface ProjectLayout {
  /** The directory all relative paths derive from. */
  root: string;
  /** `<root>/.ralph/tasks` — parent of all per-change loop-state dirs. */
  statesDir: string;
  /** `<root>/openspec/changes` — parent of all per-change spec dirs. */
  tasksDir: string;
  /** `<root>/.ralph/agent-state.json` — orchestrator state file. */
  agentStateFile: string;
  /** `<root>/openspec/changes/<name>` — per-change spec dir. */
  changeDir(name: string): string;
  /** `<root>/.ralph/tasks/<name>` — per-change loop-state dir. */
  taskStateDir(name: string): string;
  /** `<root>/.ralph/tasks/<name>/.ralph-state.json` — per-change loop state file. */
  stateFile(name: string): string;
}

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
