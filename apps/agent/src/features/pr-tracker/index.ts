/**
 * pr-tracker — scheduler-tier recovery counter for PRs that ralphy
 * shipped to In Review. Wraps a persistent `.ralph/pr-tracker-state.json`
 * file keyed by Linear issue identifier; the coordinator's per-tick
 * merge-state scan gates its existing auto-demote behavior on
 * `PrTracker.recordFailure` so a stubbornly broken PR bails to
 * `ralph:error` after N attempts instead of bouncing forever.
 *
 * See `RLF-173` and `WORKFLOW.md` (`prTracker:` block) for the contract.
 *
 * Only the externally-consumed surface is re-exported here. Internal
 * types (`FailureReason`, `FailureDecision`, `PrTrackerOptions`,
 * `PrTrackerEntry`, `PrTrackerState`) stay module-private so knip
 * doesn't flag them as unused public surface.
 */
export { PrTracker } from "./tracker";
export { readState, PR_TRACKER_STATE_RELPATH } from "./state";
