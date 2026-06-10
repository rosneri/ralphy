/**
 * The `SpecSink` seam: a backend-neutral interface for publishing a change's
 * living design document to its tracker issue. Two implementations conform to
 * it — the Linear attachment sink ({@link createLinearSpecSink}, below) and the
 * GitHub sticky-comment sink (`../wire/tracker/github-spec-sink`). `wire.ts`
 * selects one by `tracker.kind` so the coordinator's `syncTasks` hook never
 * references a concrete backend.
 */

import { syncSpecAttachments, type SpecAttachmentMutations } from "./spec-attachments";
import type { LogFn } from "./utils";

/** One publish request: refresh the design doc for one issue at one iteration. */
export interface SpecSyncContext {
  /** Linear issue id, OR GitHub issue number (the `LinearIssue.id` in github mode). */
  issueId: string;
  /** Absolute path to `.ralph-state.json` for this change. */
  statePath: string;
  /** Absolute path to `openspec/changes/<name>` for this change. */
  changeDir: string;
  iteration: number;
  log: LogFn;
}

export interface SpecSink {
  /** Publish/refresh the design doc for one issue at one iteration. Best-effort —
   *  resolves even when the backend write fails. */
  sync(ctx: SpecSyncContext): Promise<void>;
  /** Re-read the published design markdown (sans wrapper/marker), or `null` when
   *  absent. Primarily proves the GitHub write→read round-trip; the Linear sink
   *  returns `null` (attachments are not re-read today). */
  read(ctx: Pick<SpecSyncContext, "issueId">): Promise<string | null>;
}

/**
 * Linear attachment sink: delegates {@link SpecSink.sync} to the existing
 * {@link syncSpecAttachments}, mapping the neutral context onto its deps. No
 * attachment/hash/revision logic changes — only the call site moves behind the
 * seam. `read` returns `null` (the round-trip requirement is GitHub-specific).
 */
export function createLinearSpecSink(deps: {
  apiKey: string;
  mutations: SpecAttachmentMutations;
  formats?: ("md" | "pdf")[];
  sealedRevisionMode?: "append" | "replace";
}): SpecSink {
  return {
    sync: (ctx) =>
      syncSpecAttachments({
        apiKey: deps.apiKey,
        issueId: ctx.issueId,
        statePath: ctx.statePath,
        changeDir: ctx.changeDir,
        iteration: ctx.iteration,
        log: ctx.log,
        mutations: deps.mutations,
        ...(deps.formats ? { formats: deps.formats } : {}),
        ...(deps.sealedRevisionMode ? { sealedRevisionMode: deps.sealedRevisionMode } : {}),
      }),
    read: async () => null,
  };
}
