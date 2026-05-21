import type { Feature } from "../types";
import { detectImplement } from "./detect";
import { runImplement } from "./run";
import { implementPostTask } from "./postTask";

/**
 * Implement vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). Owns the `pr` slot in `.ralph-state.json` — the
 * `postTask` records the PR URL + open timestamp for telemetry and
 * emits `feature.implement.{completed,failed}` based on whether a PR
 * exists for the branch.
 *
 * The legacy push + hook-fix retry loop and `gh pr create` path in
 * `post-task.ts` (`runPrPhase` / `createPrWithRetry`) remain in place
 * until the final cleanup task in this stage deletes them; both paths
 * coexist safely because this slice's `postTask` is a side-effect-free
 * verifier.
 */
export const implementFeature: Feature = {
  id: "implement",
  ownedSlot: "pr",
  detect: detectImplement,
  run: runImplement,
  postTask: implementPostTask,
};

export { detectImplement, runImplement, implementPostTask };
