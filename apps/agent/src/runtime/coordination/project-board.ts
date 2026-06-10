/**
 * The lifecycle-pipeline board as a PURE derivation (RFC #402): precedence-
 * ordered sources + flow snapshot views + this poll's PR URLs in, TicketRows
 * out. No I/O, no actors, no Date.now — the coordinator shell gathers the
 * inputs and this module owns every projection rule, so the board is
 * table-testable without a single mock.
 */
import type { FlowSnapshotView } from "@ralphy/core/machines";
import type { TrackedIssue } from "@ralphy/tracker";
import {
  machineStateToTicketState,
  type TicketRecovery,
  type TicketRow,
  type TicketState,
} from "../../components/task-pipeline";

/** Which input source a board row was resolved from, in precedence order.
 *  Decides the base state before recovery overlays apply. */
export type TicketSourceKind =
  | "worker"
  | "queued"
  | "in-progress"
  | "todo"
  | "mention"
  | "awaiting";

export interface BoardSource {
  issue: TrackedIssue;
  kind: TicketSourceKind;
  changeName: string;
}

export interface ProjectBoardInputs {
  /** Precedence-ordered (active worker → queued → in-progress → todo →
   *  mention); the first occurrence of an issue id wins, which also fixes
   *  the render order. */
  sources: readonly BoardSource[];
  /** Flow snapshot views keyed by issue id, for the actor-backed sources.
   *  A missing entry is treated as a fresh `idle` actor. */
  snapshots: ReadonlyMap<string, FlowSnapshotView>;
  /** PR URL per issue id discovered by this poll's merge-state scan. */
  prUrlByIssue: ReadonlyMap<string, string>;
}

/**
 * Build the board — one {@link TicketRow} per live ticket.
 *
 * State comes from the flow snapshot for actor-backed rows; `todo` / `review`
 * / `awaiting` are assigned directly for backlog, mention, and gated sources
 * (no actor is materialized for them). Two overlays apply to actor-backed
 * rows only:
 *  - a quarantine wins outright → `quarantined` (rendered via `recovery.bailed`);
 *  - otherwise a live recovery record folds onto the display state when the
 *    actor merely rests in a waiting state (`awaiting-ci` / `in-progress` /
 *    `working`), so a red PR whose recovery is gated off still reads as
 *    failing rather than cleanly waiting.
 *
 * `done` / disposed tickets are excluded — `done` is a transient glyph, not a
 * resting row.
 */
export function projectBoard(inputs: ProjectBoardInputs): TicketRow[] {
  const seen = new Set<string>();
  const rows: TicketRow[] = [];
  for (const source of inputs.sources) {
    if (seen.has(source.issue.id)) continue;
    seen.add(source.issue.id);
    const row = resolveRow(source, inputs);
    if (row) rows.push(row);
  }
  return rows;
}

function resolveRow(source: BoardSource, inputs: ProjectBoardInputs): TicketRow | null {
  const { issue, kind, changeName } = source;
  let state: TicketState;
  let recovery: TicketRecovery | undefined;
  /** PR URL recorded on the flow snapshot by the failing detection — the
   *  restart-proof fallback when this poll's scan didn't resolve one. */
  let recoveryPrUrl: string | undefined;
  if (kind === "todo") {
    state = "todo";
  } else if (kind === "mention") {
    state = "review";
  } else if (kind === "awaiting") {
    // Gated tickets park outside the flow machine (the confirmation feature
    // owns their state), so the actor snapshot wouldn't read `awaiting` —
    // assign it directly, the same way `todo` / `mention` are.
    state = "awaiting";
  } else if (kind !== "worker" && issue.blockedByIds.length > 0) {
    // A blocked ticket the dependency gate skips isn't progressing — yet it
    // may already sit in Linear's "In Progress" with a flow actor resting in
    // `working` (it was flipped before the blocker was added, or before the
    // gate existed). Reading that actor would paint it as active work; render
    // it as a parked `todo` instead so the board matches reality. A ticket
    // with a *live* worker (kind `worker`) keeps its real state.
    state = "todo";
  } else {
    const view = inputs.snapshots.get(issue.id);
    state = machineStateToTicketState(view?.value ?? "idle");
    if (state === "done") return null;
    // A queued ticket is picked but not yet spawned (waiting for a worker
    // slot). Pickup drives the actor to `working`/`in-progress`, so without
    // this it reads as actively `working` while no worker exists — the
    // "working … waiting for worker" contradiction. Show it as `queued`.
    if (kind === "queued" && (state === "working" || state === "in-progress")) state = "queued";
    // Recovery detail comes from the machine context (the single source of
    // truth now that the pr-tracker file is gone).
    const flowRecovery = view?.recovery;
    if (flowRecovery) {
      recovery = {
        attempts: flowRecovery.attempts,
        bailed: state === "quarantined",
        firstFailedAt: flowRecovery.firstFailedAt,
        lastReason: flowRecovery.lastReason,
      };
      if (flowRecovery.prUrl) recoveryPrUrl = flowRecovery.prUrl;
      // Fold an unresolved failure onto a still-waiting actor so a red PR
      // whose recovery is gated off still reads as failing rather than
      // cleanly waiting (the motivating scenario).
      if (state === "awaiting-ci" || state === "in-progress" || state === "working") {
        state = flowRecovery.lastReason === "conflicting" ? "conflict-fix" : "ci-fix";
      }
    }
  }

  const prUrl = inputs.prUrlByIssue.get(issue.id) ?? recoveryPrUrl;
  return {
    changeName,
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    priority: issue.priority,
    state,
    blockedByIds: issue.blockedByIds,
    blockedByIdentifiers: issue.blockedByIdentifiers ?? [],
    ...(recovery ? { recovery } : {}),
    ...(prUrl ? { prUrl } : {}),
  };
}
