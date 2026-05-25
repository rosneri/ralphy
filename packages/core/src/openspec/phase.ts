/**
 * OpenSpec lifecycle phase derivation.
 *
 * A change progresses through: proposal → design → tasks → implement → done.
 * The phase is inferred from the state of the files inside the change
 * directory (`proposal.md`, `design.md`, `tasks.md`), so the agent-mode UI
 * can surface where the worker is in the broader lifecycle alongside the
 * loop's own runtime phase (working / pushing / ci-poll / ...).
 *
 * After RLF-91 the phase is purely artifact-driven — the gate state lives in
 * `@ralphy/core/detections.gateActive`, the two surfaces are independent.
 */

export type OpenSpecPhase = "proposal" | "design" | "tasks" | "implement" | "review" | "done";

export interface OpenSpecPhaseInputs {
  /** Contents of `proposal.md`, or `null` if the file does not exist. */
  proposal: string | null;
  /** Contents of `design.md`, or `null` if the file does not exist. */
  design: string | null;
  /** Contents of `tasks.md`, or `null` if the file does not exist. */
  tasks: string | null;
  /** Contents of `review-findings.md`, or `null` if no review has run yet. */
  reviewFindings: string | null;
  /** Number of review rounds already completed. */
  reviewRounds: number;
  /** Maximum allowed review rounds (0 = review phase disabled). */
  maxReviewRounds: number;
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
 * Derive the current OpenSpec phase from the change's artifacts. Thin
 * wrapper over `derivePlanPhase` in `@ralphy/core/detections` so the two
 * derivations cannot drift.
 *
 * When `maxReviewRounds > 0` (review enabled), a "review" → "design" loop is
 * inserted after all tasks complete:
 *   - no review run yet          → "review"  (trigger first review pass)
 *   - open findings + under cap  → "design"  (loop back for a fix cycle)
 *   - no findings OR cap reached → "done"
 *
 * When `maxReviewRounds === 0` (default) the behaviour is unchanged.
 */
export function deriveOpenSpecPhase(inputs: OpenSpecPhaseInputs): OpenSpecPhase {
  const { proposal, design, tasks, reviewFindings, reviewRounds, maxReviewRounds } = inputs;
  const allTasksDone = tasks !== null && tasks.trim() !== "" && !/^- \[ \]/m.test(tasks);

  if (allTasksDone) {
    if (maxReviewRounds > 0) {
      if (reviewFindings === null) return "review";
      const openCount = countOpenFindings(reviewFindings);
      if (openCount > 0 && reviewRounds < maxReviewRounds) return "design";
    }
    return "done";
  }

  if (isStubArtifact(proposal)) return "proposal";
  if (isStubArtifact(design)) return "design";
  if (tasks !== null && /^- \[ \]/m.test(tasks)) return "implement";
  return "tasks";
}

/**
 * Count the number of open (unchecked) findings in a review-findings file.
 * Only items under a `## Open` heading are counted; items under other headings
 * (e.g. `## Resolved`) are ignored.
 */
export function countOpenFindings(content: string): number {
  const lines = content.split("\n");
  let inOpenSection = false;
  let count = 0;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      inOpenSection = /^##\s+Open\b/i.test(line);
      continue;
    }
    if (inOpenSection && line.startsWith("- [ ]")) count++;
  }
  return count;
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
  "implement",
  "review",
];

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
 * | review    | yes      | no                         | no                              |
 * | done      | no       | yes                        | yes                             |
 */
export function shouldShowPhasePipeline(phase: OpenSpecPhase | undefined | null): boolean {
  return phase === "proposal" || phase === "design" || phase === "tasks" || phase === "review";
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
