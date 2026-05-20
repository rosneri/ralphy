/**
 * OpenSpec lifecycle phase derivation.
 *
 * A change progresses through: proposal → design → tasks → implement → done.
 * The phase is inferred from the state of the files inside the change
 * directory (`proposal.md`, `design.md`, `tasks.md`), so the agent-mode UI
 * can surface where the worker is in the broader lifecycle alongside the
 * loop's own runtime phase (working / pushing / ci-poll / ...).
 */

export type OpenSpecPhase =
  | "proposal"
  | "design"
  | "tasks"
  | "awaiting-confirmation"
  | "implement"
  | "done";

export interface OpenSpecPhaseInputs {
  /** Contents of `proposal.md`, or `null` if the file does not exist. */
  proposal: string | null;
  /** Contents of `design.md`, or `null` if the file does not exist. */
  design: string | null;
  /** Contents of `tasks.md`, or `null` if the file does not exist. */
  tasks: string | null;
  /**
   * True when this ticket is currently subject to the human-confirmation gate
   * (confirmation mode enabled and the opt-out label is absent). Defaults to
   * false so callers that do not pass it behave exactly as before.
   */
  confirmationGated?: boolean;
  /**
   * True when the human has signalled approval (e.g. the `getApproved`
   * indicator matched). Defaults to false.
   */
  approved?: boolean;
}

/**
 * True when a markdown artifact has no meaningful body beyond headings and
 * italic placeholder lines (e.g. `_Fill in the technical design..._`).
 *
 * Used to distinguish a scaffolded stub from a filled-in artifact. We
 * intentionally treat italic-only lines as placeholders because the
 * scaffolded templates use that convention to mark "to be written" sections.
 */
export function isStubArtifact(content: string | null): boolean {
  if (content === null) return true;
  const lines = content.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue; // heading
    if (/^_.*_$/.test(line)) continue; // italic placeholder
    return false;
  }
  return true;
}

/**
 * True when `tasks.md` has no unchecked `- [ ]` items left.
 */
function tasksAllChecked(tasks: string): boolean {
  return !/^- \[ \]/m.test(tasks);
}

/**
 * Derive the current OpenSpec phase from the change's artifacts.
 *
 * Priority (highest-progress first):
 *   1. `done`                  — `tasks.md` exists and has no unchecked items
 *   2. `proposal`              — `proposal.md` missing or stub
 *   3. `design`                — `design.md` missing or stub
 *   4. `awaiting-confirmation` — gated + tasks have unchecked items + not yet approved
 *   5. `implement`             — `tasks.md` has unchecked items
 *   6. `tasks`                 — fallback (no tasks file yet, but earlier artifacts present)
 */
export function deriveOpenSpecPhase(inputs: OpenSpecPhaseInputs): OpenSpecPhase {
  const { proposal, design, tasks, confirmationGated = false, approved = false } = inputs;
  if (tasks !== null && tasks.trim() !== "" && tasksAllChecked(tasks)) {
    return "done";
  }
  if (isStubArtifact(proposal)) return "proposal";
  if (isStubArtifact(design)) return "design";
  if (tasks !== null && /^- \[ \]/m.test(tasks)) {
    if (confirmationGated && !approved) return "awaiting-confirmation";
    return "implement";
  }
  return "tasks";
}

export type PhaseSegmentStatus = "done" | "current" | "pending";

export interface PhaseSegment {
  phase: Exclude<OpenSpecPhase, "done">;
  label: string;
  status: PhaseSegmentStatus;
}

export const PIPELINE_PHASES: ReadonlyArray<Exclude<OpenSpecPhase, "done">> = [
  "proposal",
  "design",
  "tasks",
  "awaiting-confirmation",
  "implement",
];

/**
 * Build the ordered phase pipeline (`proposal → design → tasks → implement`)
 * with per-segment status derived from the current phase. `done` collapses
 * to all-segments-done.
 */
/**
 * Phase-gating predicates for the agent-mode UI. They encode the matrix:
 *
 * | phase     | pipeline | subtasks (when toggled on) | progress bar (when toggled off) |
 * | --------- | -------- | -------------------------- | ------------------------------- |
 * | undefined | no       | yes                        | yes                             |
 * | proposal  | yes      | no                         | no                              |
 * | design    | yes      | no                         | no                              |
 * | tasks     | yes      | no                         | no                              |
 * | implement | no       | yes                        | yes                             |
 * | done      | no       | yes                        | yes                             |
 */
export function shouldShowPhasePipeline(phase: OpenSpecPhase | undefined | null): boolean {
  return phase === "proposal" || phase === "design" || phase === "tasks";
}

export function shouldShowSubtasksPanel(
  phase: OpenSpecPhase | undefined | null,
  showPendingTasks: boolean,
  hasSubtasks: boolean,
): boolean {
  if (!showPendingTasks || !hasSubtasks) return false;
  return phase == null || phase === "implement" || phase === "done";
}

export function shouldShowProgressBar(
  phase: OpenSpecPhase | undefined | null,
  showPendingTasks: boolean,
  hasProgress: boolean,
): boolean {
  if (showPendingTasks || !hasProgress) return false;
  return phase == null || phase === "implement" || phase === "done";
}

export function phasePipeline(phase: OpenSpecPhase): PhaseSegment[] {
  if (phase === "done") {
    return PIPELINE_PHASES.map((p) => ({ phase: p, label: p, status: "done" }));
  }
  const idx = PIPELINE_PHASES.indexOf(phase);
  return PIPELINE_PHASES.map((p, i) => ({
    phase: p,
    label: p,
    status: i < idx ? "done" : i === idx ? "current" : "pending",
  }));
}
