/**
 * OpenSpec lifecycle phase derivation.
 *
 * A change progresses through: proposal → design → tasks → implement → done.
 * The phase is inferred from the state of the files inside the change
 * directory (`proposal.md`, `design.md`, `tasks.md`), so the agent-mode UI
 * can surface where the worker is in the broader lifecycle alongside the
 * loop's own runtime phase (working / pushing / ci-poll / ...).
 */

export type OpenSpecPhase = "proposal" | "design" | "tasks" | "implement" | "done";

export interface OpenSpecPhaseInputs {
  /** Contents of `proposal.md`, or `null` if the file does not exist. */
  proposal: string | null;
  /** Contents of `design.md`, or `null` if the file does not exist. */
  design: string | null;
  /** Contents of `tasks.md`, or `null` if the file does not exist. */
  tasks: string | null;
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
 *   1. `done`     — `tasks.md` exists and has no unchecked items
 *   2. `proposal` — `proposal.md` missing or stub
 *   3. `design`   — `design.md` missing or stub
 *   4. `implement`— `tasks.md` has unchecked items
 *   5. `tasks`    — fallback (no tasks file yet, but earlier artifacts present)
 */
export function deriveOpenSpecPhase(inputs: OpenSpecPhaseInputs): OpenSpecPhase {
  const { proposal, design, tasks } = inputs;
  if (tasks !== null && tasks.trim() !== "" && tasksAllChecked(tasks)) {
    return "done";
  }
  if (isStubArtifact(proposal)) return "proposal";
  if (isStubArtifact(design)) return "design";
  if (tasks !== null && /^- \[ \]/m.test(tasks)) return "implement";
  return "tasks";
}
