import type { LinearIssue } from "../../agent/linear";
import type { Feature } from "../types";
import { detectConfirmation } from "./detect";
import { runConfirmation } from "./run";

/**
 * Capability bundle the wire layer hands to the confirmation feature via
 * `FeatureCtx.caps.confirmation`. The slice itself stays free of
 * Linear/project-layout imports; wire owns the closures.
 *
 * - `detect(issue)` cheaply decides whether this poll's issue is parked
 *   in the awaiting-confirmation gate. It is permitted to have side
 *   effects (e.g. persist `confirmedAt` on first observation) because
 *   the legacy `classifyAwaitingConfirmation` it replaces did so too.
 * - `run(issue)` performs the full inspect+react flow when detect
 *   claimed: post plan-ready comment, inspect for approval/revise, write
 *   state, surface the awaiting-ticket callback.
 */
export interface ConfirmationCaps {
  detect(issue: LinearIssue): Promise<boolean>;
  run(issue: LinearIssue): Promise<void>;
}

export const confirmationFeature: Feature = {
  id: "confirmation",
  ownedSlot: "confirmation",
  detect: detectConfirmation,
  run: runConfirmation,
};

export { detectConfirmation, runConfirmation };
