/** Pure helpers, constants, and layout math shared by the AgentMode TUI render. */

import type { ActiveWorker } from "../../agent/coordinator";
import type { OpenSpecPhase } from "@ralphy/core/openspec-phase";
import {
  buildBoardTree,
  orderActiveWorkersFirst,
  type BoardTreeRow,
  type PipelineNode,
  type PipelineNodeStatus,
  type TicketRow,
} from "../task-pipeline";

export const TAIL_BUFFER_SIZE = 30;
export const CMD_DISPLAY_MAX = 80;
export const MAX_PENDING_DISPLAY = 15;
/** Max ticket rows the board renders before overflowing the rest into a compact
 *  horizontal identifier strip. Ctrl+F (full screen) raises this to fill the
 *  terminal height. */
export const MAX_BOARD_ROWS = 10;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Board states that imply a worker should be running. A row in one of these
 *  with no active worker is waiting for a worker slot — surfaced as a "waiting
 *  for worker" mark in place of the (meaningless, not-yet-ticking) age timer. */
export const WORKER_WAIT_STATES = new Set<TicketRow["state"]>([
  "queued",
  "working",
  "in-progress",
  "conflict-fix",
  "ci-fix",
  "review",
]);

/** Board states that are advancing on their own — a live/imminent worker or an
 *  automated PR/CI step. A board with none of these and no startable todo is
 *  stalled: everything left is blocked, gated (awaiting), or bailed. */
export const ADVANCING_STATES = new Set<TicketRow["state"]>([
  "queued",
  "working",
  "in-progress",
  "conflict-fix",
  "ci-fix",
  "review",
  "awaiting-ci",
]);

/** Tmux mangles OSC 8 sequences — skip hyperlinks inside tmux. */
export const HYPERLINKS_SUPPORTED = !process.env["TMUX"];

/** Human-readable lifecycle node labels, in pipeline order. */
export const NODE_LABELS: Record<PipelineNode, string> = {
  todo: "todo",
  confirmation: "conf",
  work: "work",
  PR: "PR",
  CI: "CI",
  done: "done",
};
/** Each node's glyph/label is centered in this many columns so the header
 *  labels line up over the row glyphs even when a glyph is double-width. */
export const NODE_CELL_WIDTH = 4;
export const PIPELINE_CONNECTOR = "──";

/**
 * Reorder subtasks for the capped SUBTASKS panel: unchecked items first,
 * then completed items, each group stable in file order. Because
 * `prependFixTask` always adds new sections at the top of `tasks.md`, the
 * newest unchecked task (e.g. `Fix failing CI checks`) ends up at row 1 of
 * the panel, and the `+N more` ellipsis only ever truncates completed
 * items. The expanded view (`Ctrl+L`) bypasses this and renders
 * everything in literal file order.
 */
export function orderSubtasksForCappedDisplay<T extends { done: boolean }>(
  subtasks: readonly T[],
): T[] {
  const pending: T[] = [];
  const done: T[] = [];
  for (const s of subtasks) (s.done ? done : pending).push(s);
  return [...pending, ...done];
}

export function fmtCmd(argv: string[]): string {
  const joined = argv.join(" ");
  return joined.length > CMD_DISPLAY_MAX ? joined.slice(0, CMD_DISPLAY_MAX - 1) + "…" : joined;
}

export function calcProgressBar(
  checked: number,
  total: number,
  width: number,
): {
  countStr: string;
  filledLeft: number;
  leftSlot: number;
  filledRight: number;
  rightSlot: number;
} | null {
  const countStr = `${checked}/${total}`;
  const inner = width - 2; // for [ and ]
  if (inner < countStr.length + 2) return null;
  const leftSlot = Math.floor((inner - countStr.length) / 2);
  const rightSlot = Math.max(0, inner - countStr.length - leftSlot);
  const filled = total > 0 ? Math.round((checked / total) * inner) : 0;
  const filledLeft = Math.min(filled, leftSlot);
  const filledRight = Math.max(0, Math.min(filled - leftSlot - countStr.length, rightSlot));
  return { countStr, filledLeft, leftSlot, filledRight, rightSlot };
}

/** Extract a short label from a GitHub PR URL, e.g. "#123". */
export function prLabel(prUrl: string): string {
  const m = prUrl.match(/\/pull\/(\d+)/);
  return m ? `#${m[1]}` : "PR";
}

export function modeBadge(mode: string): { text: string; color: string } {
  switch (mode) {
    case "fresh":
      return { text: "NEW", color: "cyan" };
    case "resume":
      return { text: "RES", color: "yellow" };
    case "conflict-fix":
      return { text: "FIX", color: "magenta" };
    default:
      return { text: mode.toUpperCase(), color: "white" };
  }
}

export function phaseColor(phase: string): string {
  switch (phase) {
    case "working":
      return "cyan";
    case "scaffolding":
      return "magenta";
    case "pushing":
    case "push-retry":
    case "rebasing":
    case "pr-create":
      return "yellow";
    case "ci-poll":
    case "ci-fix":
      return "blue";
    case "auto-merge-enabled":
      return "green";
    case "teardown":
    case "cleanup":
      return "gray";
    case "done":
      return "green";
    case "gave-up":
      return "red";
    default:
      return "white";
  }
}

export function openspecPhaseColor(phase: OpenSpecPhase): string {
  switch (phase) {
    case "proposal":
      return "magenta";
    case "design":
      return "blue";
    case "tasks":
      return "cyan";
    case "implement":
      return "yellow";
    case "review":
      return "magenta";
    case "done":
      return "green";
  }
}

export function workerBorderColor(phase: string): string {
  switch (phase) {
    case "working":
    case "scaffolding":
      return "cyan";
    case "pushing":
    case "push-retry":
    case "rebasing":
    case "pr-create":
      return "yellow";
    case "ci-poll":
    case "ci-fix":
      return "blue";
    case "done":
      return "green";
    case "gave-up":
      return "red";
    default:
      return "gray";
  }
}

/** Tail-line budget for the single focused active card, scaled to how many
 *  rows the board occupies above it so the OUTPUT feed fills the rest. */
export function focusedCardTailLines(termHeight: number, fixedOverhead: number): number {
  return Math.max(3, termHeight - fixedOverhead);
}

export function glyphColor(status: PipelineNodeStatus): string {
  switch (status) {
    case "done":
      return "green";
    case "current":
      return "cyan";
    case "pending":
      return "gray";
    case "failed":
      return "red";
    case "bailed":
      return "magenta";
  }
}

/** Derived, render-ready windowing of the board: which rows are visible, which
 *  overflow into the identifier strip, the focused row/worker, and the OUTPUT
 *  tail-line budget. Pure given the inputs so it can live outside the component. */
export interface BoardLayout {
  tree: BoardTreeRow[];
  focusedIndex: number;
  focusedRow: TicketRow | undefined;
  focusedWorker: ActiveWorker | undefined;
  boardCap: number;
  winStart: number;
  visibleTree: BoardTreeRow[];
  hiddenIdentifiers: string[];
  overflowStripLines: number;
  steeringActive: boolean;
  boardHidden: boolean;
  focusedTailLines: number;
}

export function computeBoardLayout(input: {
  board: TicketRow[];
  activeWorkers: readonly ActiveWorker[];
  focusedId: string | null;
  boardFullScreen: boolean;
  cardFullScreen: boolean;
  isRawModeSupported: boolean;
  termWidth: number;
  termHeight: number;
  activeCount: number;
}): BoardLayout {
  const {
    board,
    activeWorkers,
    focusedId,
    boardFullScreen,
    cardFullScreen,
    isRawModeSupported,
    termWidth,
    termHeight,
  } = input;

  const liveWorkerIds = new Set(activeWorkers.map((w) => w.issueId));
  const tree = buildBoardTree(orderActiveWorkersFirst(board, liveWorkerIds));
  const focusedIndex = (() => {
    if (tree.length === 0) return -1;
    const i = tree.findIndex((t) => t.row.id === focusedId);
    return i >= 0 ? i : 0;
  })();
  const focusedRow = focusedIndex >= 0 ? tree[focusedIndex]!.row : undefined;
  const focusedWorker = focusedRow
    ? activeWorkers.find((w) => w.issueId === focusedRow.id)
    : undefined;

  const boardCap = boardFullScreen
    ? Math.max(MAX_BOARD_ROWS, termHeight - 9)
    : Math.min(MAX_BOARD_ROWS, tree.length);
  const winStart = (() => {
    if (tree.length <= boardCap || focusedIndex < 0) return 0;
    if (focusedIndex < boardCap) return 0;
    return Math.min(focusedIndex - boardCap + 1, tree.length - boardCap);
  })();
  const visibleTree = tree.slice(winStart, winStart + boardCap);
  const hiddenIdentifiers = tree
    .filter((_, i) => i < winStart || i >= winStart + boardCap)
    .map((t) => t.row.identifier);

  const steeringActive = isRawModeSupported && focusedWorker !== undefined && !boardFullScreen;

  const overflowStripLines =
    hiddenIdentifiers.length === 0
      ? 0
      : Math.max(
          1,
          Math.ceil((hiddenIdentifiers.join(" · ").length + 8) / Math.max(20, termWidth)),
        );

  const steeringBoxLines = steeringActive ? 3 : 0;
  const boardHidden = cardFullScreen && focusedWorker !== undefined;
  const boardOverhead = boardHidden ? 0 : 4 + visibleTree.length + overflowStripLines;
  const cardOverhead = boardFullScreen ? 0 : 8;
  const fixedOverhead = 5 + boardOverhead + cardOverhead + steeringBoxLines;
  const focusedTailLines = focusedCardTailLines(termHeight, fixedOverhead);

  return {
    tree,
    focusedIndex,
    focusedRow,
    focusedWorker,
    boardCap,
    winStart,
    visibleTree,
    hiddenIdentifiers,
    overflowStripLines,
    steeringActive,
    boardHidden,
    focusedTailLines,
  };
}
