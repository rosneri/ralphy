/**
 * pr-tracker — scheduler-tier recovery counter for PRs that ralphy
 * shipped to In Review. Wraps a persistent `.ralph/pr-tracker-state.json`
 * file keyed by Linear issue identifier; the coordinator's per-tick
 * merge-state scan gates its existing auto-demote behavior on
 * `PrTracker.recordFailure` so a stubbornly broken PR bails to
 * `ralph:error` after N attempts instead of bouncing forever.
 *
 * See `RLF-173` and `WORKFLOW.md` (`prTracker:` block) for the contract.
 */
export { PrTracker } from "./tracker";
export type { FailureReason, FailureDecision, PrTrackerOptions } from "./tracker";
export {
  readState,
  writeState,
  PR_TRACKER_STATE_RELPATH,
  type PrTrackerEntry,
  type PrTrackerState,
} from "./state";
