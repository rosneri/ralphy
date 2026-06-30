/**
 * Pure lifecycle-pipeline vocabulary for the agent TUI task board.
 *
 * The board renders one line per ticket as a six-node pipeline —
 * `todo → confirmation → work → PR → CI → done` — where each node carries a
 * status glyph.
 * This module owns the *vocabulary*: the per-ticket {@link TicketState}
 * union, the projection of a ticket onto pipeline nodes
 * ({@link pipelineStages}), the human-readable {@link statusLabel}, and the
 * total mapping from raw `flow.machine` state values onto {@link TicketState}
 * ({@link machineStateToTicketState}).
 *
 * Everything here is pure and exhaustively unit-tested. The coordinator
 * builds {@link TicketRow}s; the React layer renders them via these helpers —
 * neither owns the lifecycle vocabulary.
 */

/**
 * The state of a ticket *as the board sees it*. This is a board-level
 * projection, not the raw machine state: it folds the `flow.machine`'s
 * transient internals (`preempting`, `routing-after-preempt`) back onto
 * their effective resting state, and adds board-only states the machine
 * never models — `queued` (picked, not yet running) and `quarantined`
 * (the pr-tracker bailed after exhausting auto-recovery).
 */
export type TicketState =
  | "todo"
  | "queued"
  | "working"
  | "in-progress"
  | "awaiting"
  | "awaiting-ci"
  | "conflict-fix"
  | "ci-fix"
  | "review"
  | "quarantined"
  | "done"
  | "error";

/** Recovery metadata projected from the pr-tracker entry onto a board row. */
export interface TicketRecovery {
  attempts: number;
  /** Absent only for malformed entries; the helpers treat absence as
   *  `ci_failed` so the failure still lands on a pipeline node. */
  lastReason?: "conflicting" | "ci_failed";
  bailed: boolean;
  /** ISO timestamp of the first detected failure — the AGE clock for
   *  failing / quarantined rows. */
  firstFailedAt: string;
}

/** One ticket line on the board. */
export interface TicketRow {
  changeName: string;
  id: string;
  identifier: string;
  title: string;
  /** Issue (tracker) URL — always present. */
  url: string;
  /** Discovered PR URL, when the merge-state scan resolved one this poll.
   *  Absent for todo rows with no PR yet and for active-worker rows the scan
   *  skips (the focused card sources those from live worker meta instead). */
  prUrl?: string;
  priority: number;
  state: TicketState;
  recovery?: TicketRecovery;
  /** Ids of issues that block this ticket and are still open. Drives the
   *  dependency tree: a row nests under the in-board blockers named here.
   *  Absent/empty for unblocked rows. */
  blockedByIds?: string[];
  /** Human identifiers (e.g. "ENG-123") of the open blockers in
   *  {@link blockedByIds}, same order. Used to name blockers in the row's
   *  "waiting on …" annotation, including blockers not present on the board. */
  blockedByIdentifiers?: string[];
}

/** The six lifecycle nodes rendered left-to-right on every row. `confirmation`
 *  sits between `todo` and `work` — the human plan-approval gate, where an
 *  `awaiting` ticket parks. */
export type PipelineNode = "todo" | "confirmation" | "work" | "PR" | "CI" | "done";

/**
 * Per-node status:
 * - `done`    — the node has been passed (✓)
 * - `current` — the node is where work is happening right now (●)
 * - `pending` — the node has not been reached (○)
 * - `failed`  — the node failed and is being auto-recovered (✗)
 * - `bailed`  — the node failed and recovery was exhausted; needs a human (⛔)
 */
export type PipelineNodeStatus = "done" | "current" | "pending" | "failed" | "bailed";

interface PipelineStage {
  node: PipelineNode;
  status: PipelineNodeStatus;
}

/** Glyph table for {@link PipelineNodeStatus}. Single source for the UI. */
export const STATUS_GLYPH: Record<PipelineNodeStatus, string> = {
  done: "✓",
  current: "●",
  pending: "○",
  failed: "✗",
  bailed: "⛔",
};

/** Node order, fixed. */
export const PIPELINE_NODES: readonly PipelineNode[] = [
  "todo",
  "confirmation",
  "work",
  "PR",
  "CI",
  "done",
];

function stages(
  todo: PipelineNodeStatus,
  confirmation: PipelineNodeStatus,
  work: PipelineNodeStatus,
  pr: PipelineNodeStatus,
  ci: PipelineNodeStatus,
  done: PipelineNodeStatus,
): PipelineStage[] {
  return [
    { node: "todo", status: todo },
    { node: "confirmation", status: confirmation },
    { node: "work", status: work },
    { node: "PR", status: pr },
    { node: "CI", status: ci },
    { node: "done", status: done },
  ];
}

/**
 * Project a ticket onto its six pipeline nodes. Total over
 * {@link TicketState}; the `never` assertion makes any new state a compile
 * error until it is mapped here.
 *
 * The failure glyph for a `quarantined` row lands on the node implied by
 * `recovery.lastReason` — `conflicting` is a PR-mergeability failure (PR
 * node), `ci_failed` is a CI failure (CI node) — so a conflict→CI bail
 * reads as ⛔ on CI, matching the last thing that failed.
 */
export function pipelineStages(row: TicketRow): PipelineStage[] {
  const state = row.state;
  switch (state) {
    case "todo":
      return stages("current", "pending", "pending", "pending", "pending", "pending");
    case "awaiting":
      // Parked at the human confirmation gate, before work begins.
      return stages("done", "current", "pending", "pending", "pending", "pending");
    case "queued":
      // Picked but not yet spawned (waiting for a worker slot): past
      // confirmation, work not started. No node is `current` — it's waiting,
      // not working — so the work node stays `pending` rather than lighting up.
      return stages("done", "done", "pending", "pending", "pending", "pending");
    case "working":
    case "in-progress":
      return stages("done", "done", "current", "pending", "pending", "pending");
    case "awaiting-ci":
      return stages("done", "done", "done", "done", "current", "pending");
    case "conflict-fix":
      return stages("done", "done", "done", "failed", "pending", "pending");
    case "ci-fix":
      return stages("done", "done", "done", "done", "failed", "pending");
    case "review":
      return stages("done", "done", "current", "done", "done", "pending");
    case "quarantined":
      return row.recovery?.lastReason === "conflicting"
        ? stages("done", "done", "done", "bailed", "pending", "pending")
        : stages("done", "done", "done", "done", "bailed", "pending");
    case "done":
      return stages("done", "done", "done", "done", "done", "done");
    case "error":
      return stages("done", "done", "failed", "pending", "pending", "pending");
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function attemptCount(plural: number): string {
  return `${plural} fix attempt${plural === 1 ? "" : "s"}`;
}

/**
 * Human-readable status detail rendered after the pipeline on each row.
 * Total over {@link TicketState}.
 */
export function statusLabel(row: TicketRow): string {
  const state = row.state;
  switch (state) {
    case "todo":
      return "todo";
    case "queued":
      return "queued";
    case "working":
      return "working";
    case "in-progress":
      return "in progress";
    case "awaiting":
      return "awaiting confirmation";
    case "awaiting-ci":
      return "awaiting CI";
    case "conflict-fix":
      return `conflict · ${attemptCount(row.recovery?.attempts ?? 0)}`;
    case "ci-fix":
      return `CI red · ${attemptCount(row.recovery?.attempts ?? 0)}`;
    case "review":
      return "addressing review";
    case "quarantined": {
      const tries = row.recovery?.attempts ?? 0;
      const reason = row.recovery?.lastReason === "conflicting" ? "conflict" : "CI";
      return `quarantined · ${tries} tries (${reason}), bailed`;
    }
    case "done":
      return "done";
    case "error":
      return "error";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/**
 * Map a raw `flow.machine` state value onto a board {@link TicketState}.
 * Total over every state the machine can rest in, including the two
 * transient internals — `preempting` and `routing-after-preempt` fold onto
 * `working` because preemption is mid-work and has no distinct board
 * meaning. `idle` (a started-but-not-yet-routed actor) reads as
 * `in-progress`. Unknown values default to `working` rather than throwing,
 * so a future machine state degrades gracefully on the board.
 */
/** One row of the dependency-ordered board: the ticket, its indent depth, and
 *  the identifiers of the in-board blockers the indentation expresses. */
export interface BoardTreeRow {
  row: TicketRow;
  /** 0 for a root (no in-board blocker); otherwise `max(blocker depth) + 1`. */
  depth: number;
  /** Identifiers of this row's blockers that are also present on the board —
   *  i.e. the ones the nesting represents. Excludes blockers not on the board
   *  (those are still named via `row.blockedByIdentifiers`). */
  blockerIdentifiers: string[];
}

/**
 * Stable-partition the board so rows backed by a *live worker* lead, keeping
 * relative order within each group. Apply before {@link buildBoardTree} so
 * active work heads the list while its dependents still nest beneath it.
 *
 * "Active by worker" is liveness the row state alone can't express: a `working`
 * row with no spawned worker is merely waiting for a slot, so the caller passes
 * the actually-running worker ids rather than keying off state.
 */
export function orderActiveWorkersFirst(
  rows: TicketRow[],
  activeWorkerIds: ReadonlySet<string>,
): TicketRow[] {
  if (activeWorkerIds.size === 0) return rows.slice();
  const active: TicketRow[] = [];
  const rest: TicketRow[] = [];
  for (const r of rows) (activeWorkerIds.has(r.id) ? active : rest).push(r);
  return [...active, ...rest];
}

/**
 * Order the flat board into a dependency tree: every ticket is placed after the
 * blockers that are *also on the board* and indented one level below the
 * deepest of them, so a blocked ticket reads as nested under what it waits on.
 *
 * Roots (no in-board blocker) keep their incoming order; among a blocker's
 * dependents, incoming order is preserved too — so the result is the original
 * board with each blocked row pulled beneath its blocker subtree. Blockers not
 * present on the board are ignored for nesting (the row roots at depth 0) but
 * are still surfaced by the caller via `row.blockedByIdentifiers`.
 *
 * Pure and total: a dependency cycle (no eligible root) can't deadlock — any
 * rows left unplaced are appended in incoming order at depth 0. Row count and
 * identity are preserved exactly.
 */
export function buildBoardTree(rows: TicketRow[]): BoardTreeRow[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const orderIndex = new Map(rows.map((r, i) => [r.id, i] as const));
  // In-board blockers for a row, in the row's declared blocker order, minus
  // self-edges and dangling ids.
  const blockersOf = (r: TicketRow): string[] =>
    (r.blockedByIds ?? []).filter((id) => id !== r.id && byId.has(id));

  // blockerId → dependents, sorted by incoming board order for stable nesting.
  const childrenOf = new Map<string, TicketRow[]>();
  for (const r of rows) {
    for (const blockerId of blockersOf(r)) {
      const list = childrenOf.get(blockerId);
      if (list) list.push(r);
      else childrenOf.set(blockerId, [r]);
    }
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!);
  }

  const emitted = new Set<string>();
  const depthById = new Map<string, number>();
  const result: BoardTreeRow[] = [];

  const blockerIdentifiersOf = (r: TicketRow): string[] =>
    blockersOf(r).map((id) => byId.get(id)!.identifier);

  // Emit a row once all its in-board blockers are placed, then recurse into its
  // dependents. A row reached before a second blocker is placed simply defers.
  const tryEmit = (r: TicketRow): void => {
    if (emitted.has(r.id)) return;
    const blockers = blockersOf(r);
    if (!blockers.every((id) => emitted.has(id))) return;
    const depth =
      blockers.length === 0 ? 0 : Math.max(...blockers.map((id) => depthById.get(id)!)) + 1;
    depthById.set(r.id, depth);
    emitted.add(r.id);
    result.push({ row: r, depth, blockerIdentifiers: blockerIdentifiersOf(r) });
    for (const child of childrenOf.get(r.id) ?? []) tryEmit(child);
  };

  // Roots first, in incoming order; each pulls its subtree along.
  for (const r of rows) {
    if (blockersOf(r).length === 0) tryEmit(r);
  }
  // Cycle / unreachable fallback: place anything left at depth 0, in incoming
  // order, retrying its dependents so a freed subtree still nests.
  for (const r of rows) {
    if (emitted.has(r.id)) continue;
    depthById.set(r.id, 0);
    emitted.add(r.id);
    result.push({ row: r, depth: 0, blockerIdentifiers: blockerIdentifiersOf(r) });
    for (const child of childrenOf.get(r.id) ?? []) tryEmit(child);
  }
  return result;
}

export function machineStateToTicketState(value: string): TicketState {
  switch (value) {
    case "idle":
      return "in-progress";
    case "working":
      return "working";
    case "conflict-fix":
      return "conflict-fix";
    case "ci-fix":
      return "ci-fix";
    case "awaiting":
      return "awaiting";
    case "awaiting-ci":
      return "awaiting-ci";
    case "review":
      return "review";
    case "quarantined":
      return "quarantined";
    case "preempting":
    case "routing-after-preempt":
      return "working";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return "working";
  }
}
