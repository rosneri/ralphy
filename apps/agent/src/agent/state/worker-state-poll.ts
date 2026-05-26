import { join } from "node:path";
import { deriveOpenSpecPhase, type OpenSpecPhase } from "@ralphy/core/openspec-phase";
import { isFlowTaskHeading } from "@ralphy/core/tasks-md";

/**
 * Extract all `- [x]` / `- [ ]` items from a tasks.md document, in order.
 *
 * Skips items under:
 *  - `## Planning` — OpenSpec pipeline scaffolding, not mission work.
 *  - any section whose heading is a recognized flow-task heading
 *    (`Fix failing CI checks`, `Resolve PR merge conflicts`, …). This
 *    is the backward-compat path: new flow tasks land in
 *    `agent-tasks.md` (which this function never reads), but older
 *    in-flight `tasks.md` files may still contain inline flow sections.
 */
export function parseSubtasks(tasksMd: string): Array<{ done: boolean; text: string }> {
  const out: Array<{ done: boolean; text: string }> = [];
  let skipSection = false;
  for (const line of tasksMd.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1]!.trim();
      skipSection = title.toLowerCase() === "planning" || isFlowTaskHeading(title);
      continue;
    }
    if (skipSection) continue;
    const m = line.match(/^- \[([ xX])\] (.+)$/);
    if (m) out.push({ done: m[1] !== " ", text: m[2]!.trim() });
  }
  return out;
}

export interface WorkerSnapshot {
  iter: number;
  reviewRounds: number;
  openspecPhase: OpenSpecPhase | null;
  currentTask: string | null;
  subtasks: Array<{ done: boolean; text: string }>;
  taskProgress: { checked: number; total: number } | null;
}

export function initialWorkerSnapshot(): WorkerSnapshot {
  return {
    iter: 0,
    reviewRounds: 0,
    openspecPhase: null,
    currentTask: null,
    subtasks: [],
    taskProgress: null,
  };
}

export interface ReadWorkerStateInput {
  changeName: string;
  statesDir: string;
  changeDir: string;
  prev: WorkerSnapshot;
}

/**
 * Read the on-disk artifacts that describe a worker's current state and
 * produce an updated snapshot. Errors reading any file are swallowed so the
 * polling loop never crashes; the snapshot for that field stays at the
 * previous value.
 */
export async function readWorkerSnapshot(input: ReadWorkerStateInput): Promise<WorkerSnapshot> {
  const next: WorkerSnapshot = { ...input.prev };

  try {
    const file = Bun.file(join(input.statesDir, input.changeName, ".ralph-state.json"));
    if (await file.exists()) {
      const json = (await file.json()) as { iteration?: number; reviewRounds?: number };
      next.iter = json.iteration ?? next.iter;
      next.reviewRounds = json.reviewRounds ?? next.reviewRounds;
    }
  } catch {
    /* swallow — state file may be mid-write */
  }

  if (input.changeDir) {
    try {
      const tasksFile = Bun.file(join(input.changeDir, "tasks.md"));
      const proposalFile = Bun.file(join(input.changeDir, "proposal.md"));
      const designFile = Bun.file(join(input.changeDir, "design.md"));
      const reviewFindingsFile = Bun.file(join(input.changeDir, "review-findings.md"));
      const [tasksText, proposalText, designText, reviewFindingsText] = await Promise.all([
        tasksFile.exists().then((ok) => (ok ? tasksFile.text() : null)),
        proposalFile.exists().then((ok) => (ok ? proposalFile.text() : null)),
        designFile.exists().then((ok) => (ok ? designFile.text() : null)),
        reviewFindingsFile.exists().then((ok) => (ok ? reviewFindingsFile.text() : null)),
      ]);
      if (tasksText !== null) {
        const subtasks = parseSubtasks(tasksText);
        next.subtasks = subtasks;
        next.currentTask = subtasks.find((s) => !s.done)?.text ?? null;
        const total = subtasks.length;
        const checked = subtasks.filter((s) => s.done).length;
        next.taskProgress = total > 0 ? { checked, total } : null;
      }
      const reviewRounds = next.reviewRounds;
      next.openspecPhase = deriveOpenSpecPhase({
        proposal: proposalText,
        design: designText,
        tasks: tasksText,
        reviewFindings: reviewFindingsText,
        reviewRounds,
        maxReviewRounds: reviewFindingsText !== null || reviewRounds > 0 ? 999 : 0,
      });
    } catch {
      /* swallow */
    }
  }

  return next;
}

/**
 * Compare two snapshots and return the list of state-change events that
 * should be emitted. Same event shapes are used by both the TUI file sink
 * and the --json-output stdout sink so consumers see one consistent stream.
 */
export function diffWorkerSnapshot(
  changeName: string,
  prev: WorkerSnapshot,
  next: WorkerSnapshot,
): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  if (next.iter !== prev.iter) {
    events.push({ type: "worker_iteration", changeName, iter: next.iter });
  }
  if (next.reviewRounds !== prev.reviewRounds) {
    events.push({
      type: "worker_review_rounds",
      changeName,
      reviewRounds: next.reviewRounds,
    });
  }
  if (next.openspecPhase !== prev.openspecPhase) {
    events.push({
      type: "worker_openspec_phase",
      changeName,
      phase: next.openspecPhase,
    });
  }
  if (next.currentTask !== prev.currentTask) {
    events.push({
      type: "worker_current_task",
      changeName,
      task: next.currentTask,
      progress: next.taskProgress,
    });
  }
  return events;
}
