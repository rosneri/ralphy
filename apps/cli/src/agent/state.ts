import { join } from "node:path";
import { z } from "zod";

export const AgentStateSchema = z.object({
  processedIssueIds: z.array(z.string()).default([]),
  startedIssueIds: z.array(z.string()).default([]),
  /** Issues that exited non-zero and have been quarantined to prevent
   *  infinite retry loops. Cleared via `ralph clean --name <change>`. */
  failedIssueIds: z.array(z.string()).default([]),
  lastPollAt: z.string().nullable().default(null),
  /** Map of change-name → Linear issue identity, written by the agent at
   *  scaffold time so `ralph clean --name <change>` can find and remove
   *  the corresponding entries from processedIssueIds / startedIssueIds. */
  changeMeta: z
    .record(
      z.string(),
      z.object({
        issueId: z.string(),
        identifier: z.string(),
      }),
    )
    .default({}),
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
  return AgentStateSchema.parse(await file.json());
}

export async function writeAgentState(projectRoot: string, state: AgentState): Promise<void> {
  await Bun.write(statePath(projectRoot), JSON.stringify(state, null, 2) + "\n");
}
