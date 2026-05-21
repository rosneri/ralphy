import type { Feature } from "../types";
import { detectCiFix } from "./detect";
import { runCiFix } from "./run";
import { ciFixPostTask } from "./postTask";

/**
 * CI-fix vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). Owns the `ci` slot in `.ralph-state.json` — the
 * `postTask` records the last observed CI bucket for telemetry and
 * emits `feature.ci-fix.{completed,failed}` based on the check status.
 *
 * The legacy CI-fix loop in `post-task.ts` (`fixCiUntilGreen` /
 * `fixConflictsAndCiLoop` wantFixCi branch) remains in place until the
 * final cleanup task in this stage deletes it; both paths coexist
 * safely because this slice's `postTask` is a side-effect-free verifier.
 */
export const ciFixFeature: Feature = {
  id: "ci-fix",
  ownedSlot: "ci",
  detect: detectCiFix,
  run: runCiFix,
  postTask: ciFixPostTask,
};
