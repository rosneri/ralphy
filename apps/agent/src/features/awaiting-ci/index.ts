import type { Feature } from "../types";
import { detectAwaitingCi } from "./detect";
import { runAwaitingCi } from "./run";

/**
 * Awaiting-ci vertical slice.
 *
 * Carves the "PR is open, CI hasn't concluded" state out of the
 * implement flow. The slice owns NO state slot — it only reads
 * `state.pr` (written by the implement slice on transition) and
 * `state.ci` (verified by the ci-fix slice's postTask). Its `run`
 * makes one `gh pr checks` call via `caps.ciFix.getCiStatus()` and
 * emits a single event. No worker subprocess; no slot acquisition.
 */
export const awaitingCiFeature: Feature = {
  id: "awaiting-ci",
  ownedSlot: null,
  detect: detectAwaitingCi,
  run: runAwaitingCi,
};
