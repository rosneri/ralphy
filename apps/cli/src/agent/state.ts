import { join } from "node:path";
import { z } from "zod";

const TaskStateSchema = z.enum(["started", "processed", "failed"]);
type TaskState = z.infer<typeof TaskStateSchema>;

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

/**
 * Legacy shape from <= 2.9.4. Three parallel ID arrays plus a separate
 * `changeMeta` map keyed by change name. Detected at read time and
 * folded into the new `tasks` map so users can upgrade in place
 * without losing in-flight state. Entries in the legacy arrays that
 * have no matching `changeMeta` row (i.e. we can't recover the Linear
 * identifier) are dropped — `ralph clean` could not target them anyway.
 */
const LegacyAgentStateSchema = z
  .object({
    processedIssueIds: z.array(z.string()).default([]),
    startedIssueIds: z.array(z.string()).default([]),
    failedIssueIds: z.array(z.string()).default([]),
    lastPollAt: z.string().nullable().default(null),
    changeMeta: z
      .record(z.string(), z.object({ issueId: z.string(), identifier: z.string() }))
      .default({}),
  })
  .partial();

function migrateLegacy(raw: unknown): AgentState {
  const parsed = LegacyAgentStateSchema.safeParse(raw);
  if (!parsed.success) return AgentStateSchema.parse({});
  const legacy = parsed.data;
  const tasks: Record<string, TaskEntry> = {};
  // changeMeta is keyed by change name; flip it to issueId → {identifier, changeName}.
  const byIssueId = new Map<string, { identifier: string; changeName: string }>();
  for (const [changeName, meta] of Object.entries(legacy.changeMeta ?? {})) {
    byIssueId.set(meta.issueId, { identifier: meta.identifier, changeName });
  }
  // Resolve each legacy ID array into a tasks row. "failed" wins over
  // "processed" wins over "started" so quarantines survive the migration.
  const fold = (ids: string[] | undefined, state: TaskState) => {
    for (const issueId of ids ?? []) {
      const found = byIssueId.get(issueId);
      if (!found) continue;
      tasks[found.identifier] = {
        issueId,
        identifier: found.identifier,
        state,
        changeName: found.changeName,
      };
    }
  };
  fold(legacy.startedIssueIds, "started");
  fold(legacy.processedIssueIds, "processed");
  fold(legacy.failedIssueIds, "failed");
  // Legacy `startedIssueIds` doubled as a "Linear start comment posted"
  // flag — preserve that on the new entries.
  for (const issueId of legacy.startedIssueIds ?? []) {
    const found = byIssueId.get(issueId);
    if (!found) continue;
    const entry = tasks[found.identifier];
    if (entry) entry.commentPosted = true;
  }
  return { tasks, lastPollAt: legacy.lastPollAt ?? null };
}

function statePath(projectRoot: string): string {
  return join(projectRoot, ".ralph", "agent-state.json");
}

function looksLegacy(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    "processedIssueIds" in r || "startedIssueIds" in r || "failedIssueIds" in r || "changeMeta" in r
  );
}

export async function readAgentState(projectRoot: string): Promise<AgentState> {
  const file = Bun.file(statePath(projectRoot));
  if (!(await file.exists())) {
    return AgentStateSchema.parse({});
  }
  const raw = await file.json();
  // Detect legacy first — the new schema strips unknown fields, so a
  // legacy file would silently parse to an empty tasks map otherwise.
  if (looksLegacy(raw)) return migrateLegacy(raw);
  return AgentStateSchema.parse(raw);
}

export async function writeAgentState(projectRoot: string, state: AgentState): Promise<void> {
  await Bun.write(statePath(projectRoot), JSON.stringify(state, null, 2) + "\n");
}
