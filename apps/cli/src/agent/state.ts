import { join } from "node:path";
import { z } from "zod";
import type { AgentSnapshot, AgentTaskEntry } from "@ralphy/types";

const TaskStateSchema = z.enum(["started", "processed", "failed"]);

/**
 * One row per Linear issue the agent has touched. Keyed by the Linear
 * `identifier` (e.g. `COD-61`) in `AgentState.tasks` for human-readable
 * JSON; `issueId` (UUID) is kept as a field because Linear's API uses
 * the UUID for lookups.
 */
export const TaskEntrySchema = z.object({
  issueId: z.string(),
  identifier: z.string(),
  state: TaskStateSchema,
  /** Set once `scaffold` returns. Used by `ralph clean --name <change>`. */
  changeName: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  exitCode: z.number().optional(),
  /** Set once the "Ralph started working on this issue" Linear comment
   *  has been posted. Prevents double-comments when an in-flight issue
   *  is re-picked across agent restarts. */
  commentPosted: z.boolean().optional(),
});
export type TaskEntry = z.infer<typeof TaskEntrySchema>;

export const AgentStateSchema = z.object({
  /** Map of Linear identifier → task lifecycle entry. */
  tasks: z.record(z.string(), TaskEntrySchema).default({}),
  lastPollAt: z.string().nullable().default(null),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// Schema-drift guard: the runtime zod schema and the structural type in
// `@ralphy/types` describe the same shape. If you change one, change the
// other — these two assignments will fail to typecheck if the shapes
// diverge. Costs nothing at runtime.
const _shapeCheck1: AgentSnapshot = null as unknown as AgentState;
const _shapeCheck2: AgentState = null as unknown as AgentSnapshot;
const _entryCheck1: AgentTaskEntry = null as unknown as TaskEntry;
const _entryCheck2: TaskEntry = null as unknown as AgentTaskEntry;
void _shapeCheck1;
void _shapeCheck2;
void _entryCheck1;
void _entryCheck2;

function statePath(projectRoot: string): string {
  return join(projectRoot, ".ralph", "agent-state.json");
}

async function readState(projectRoot: string): Promise<AgentState> {
  const file = Bun.file(statePath(projectRoot));
  if (!(await file.exists())) {
    return AgentStateSchema.parse({});
  }
  const raw = await file.json();
  return AgentStateSchema.parse(raw);
}

async function writeState(projectRoot: string, state: AgentState): Promise<void> {
  await Bun.write(statePath(projectRoot), JSON.stringify(state, null, 2) + "\n");
}

/**
 * The agent's state file is a single-writer resource. The store is the
 * only legal way to mutate it: it owns the in-memory copy, applies
 * patches, and persists. Read-only consumers call `snapshot()`.
 *
 * Construct one per agent run. `load()` must be called before any other
 * method — it hydrates from disk (or yields a fresh default if the file
 * does not exist).
 */
export class AgentStateStore {
  private state: AgentState | null = null;

  constructor(private readonly projectRoot: string) {}

  async load(): Promise<void> {
    this.state = await readState(this.projectRoot);
  }

  /** Read-only view of the current state. Mutating the returned object
   *  bypasses persistence — callers must go through the mutator methods. */
  snapshot(): AgentState {
    if (!this.state) {
      throw new Error("AgentStateStore: load() must be called before snapshot()");
    }
    return this.state;
  }

  /** Insert or update a task entry, then persist. */
  async upsertTask(
    issue: { id: string; identifier: string },
    patch: Partial<TaskEntry>,
  ): Promise<void> {
    const s = this.snapshot();
    const existing = s.tasks[issue.identifier];
    s.tasks[issue.identifier] = {
      issueId: issue.id,
      identifier: issue.identifier,
      state: existing?.state ?? "started",
      ...existing,
      ...patch,
    };
    await this.flush();
  }

  async setLastPollAt(when: string | null): Promise<void> {
    const s = this.snapshot();
    s.lastPollAt = when;
    await this.flush();
  }

  /** Remove the task entry whose `changeName` matches. Returns the removed
   *  entry's `{identifier, issueId}` or null if no match. Used by
   *  `ralph clean --name <change>` to clear quarantines. */
  async removeByChangeName(
    changeName: string,
  ): Promise<{ identifier: string; issueId: string } | null> {
    const s = this.snapshot();
    const entry = Object.values(s.tasks).find((t) => t.changeName === changeName);
    if (!entry) return null;
    delete s.tasks[entry.identifier];
    await this.flush();
    return { identifier: entry.identifier, issueId: entry.issueId };
  }

  private async flush(): Promise<void> {
    await writeState(this.projectRoot, this.snapshot());
  }
}
