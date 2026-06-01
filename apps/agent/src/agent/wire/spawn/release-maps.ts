import type { LinearIssue } from "../../linear";

/** The per-change worktree bookkeeping a worker exit releases. Each map is
 *  keyed by change name and tracks where that change's live worktree is so the
 *  coordinator, mention scan, and Linear sync hooks can resolve its files. */
export interface ChangeWorktreeMaps {
  cwdByChange: Map<string, string>;
  statesDirByChange: Map<string, string>;
  branchByChange: Map<string, string>;
  issueByChange: Map<string, LinearIssue>;
}

/**
 * Release a change's worktree bookkeeping after its worker process exits.
 *
 * When the worker was reaped because the ticket flipped into
 * awaiting-confirmation, the change is NOT finished: the coordinator runs a
 * final `syncTasks` flush right after the exit so spec-attachments upload the
 * proposal.md / design.md the worker just wrote, and a later poll resumes the
 * change once the gate clears. Both paths resolve the change directory through
 * `cwdByChange` — falling back to projectRoot, the *main* checkout, when the
 * entry is absent. Deleting the entry on an awaiting exit therefore makes the
 * flush read the main checkout, where the worktree-only design.md does not
 * exist, so it is silently skipped and never uploaded (RLF-204).
 *
 * Retain the maps while a change is parked awaiting confirmation; only release
 * them on a terminal exit. A later resume re-populates them via `prepare`, and
 * the terminal exit after that resume clears them, so nothing leaks.
 */
export function releaseChangeWorktreeMaps(
  changeName: string,
  maps: ChangeWorktreeMaps,
  opts: { awaitingConfirmation: boolean },
): void {
  if (opts.awaitingConfirmation) return;
  maps.cwdByChange.delete(changeName);
  maps.statesDirByChange.delete(changeName);
  maps.branchByChange.delete(changeName);
  maps.issueByChange.delete(changeName);
}
