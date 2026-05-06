import { join } from "node:path";
import { z } from "zod";

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

function statePath(projectRoot: string): string {
  return join(projectRoot, ".ralph", "agent-state.json");
}

export async function readAgentState(projectRoot: string): Promise<AgentState> {
  const file = Bun.file(statePath(projectRoot));
  if (!(await file.exists())) {
    return AgentStateSchema.parse({});
  }
  const raw = await file.json();
  return AgentStateSchema.parse(raw);
}

export async function writeAgentState(projectRoot: string, state: AgentState): Promise<void> {
  await Bun.write(statePath(projectRoot), JSON.stringify(state, null, 2) + "\n");
}
