import { isStubArtifact } from "../openspec/phase";
import { allChecked, hasUnchecked } from "./tasks";

export type PlanPhase = "proposal" | "design" | "tasks" | "implement" | "done";

export interface PlanPhaseInputs {
  proposal: string | null;
  design: string | null;
  tasks: string | null;
}

/**
 * Derive the lifecycle phase from the change's artifacts on disk.
 *
 * Priority (highest-progress first):
 *   1. `done`      — `tasks.md` exists, non-empty, no unchecked items
 *   2. `proposal`  — `proposal.md` missing or stub
 *   3. `design`    — `design.md` missing or stub
 *   4. `implement` — `tasks.md` has unchecked items
 *   5. `tasks`     — fallback
 */
export function derivePlanPhase(inputs: PlanPhaseInputs): PlanPhase {
  const { proposal, design, tasks } = inputs;
  if (tasks !== null && tasks.trim() !== "" && allChecked(tasks)) return "done";
  if (isStubArtifact(proposal)) return "proposal";
  if (isStubArtifact(design)) return "design";
  if (tasks !== null && hasUnchecked(tasks)) return "implement";
  return "tasks";
}

export { isStubArtifact };
