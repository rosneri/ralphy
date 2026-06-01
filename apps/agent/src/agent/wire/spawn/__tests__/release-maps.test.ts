import { describe, test, expect } from "bun:test";
import { releaseChangeWorktreeMaps, type ChangeWorktreeMaps } from "../release-maps";
import type { LinearIssue } from "../../../linear";

function makeIssue(): LinearIssue {
  return {
    id: "uuid-rlf-204",
    identifier: "RLF-204",
    title: "Subtask progress",
    description: null,
    url: "https://linear.app/example/RLF-204",
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-06-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

function makeMaps(changeName: string): ChangeWorktreeMaps {
  return {
    cwdByChange: new Map([[changeName, "/wt/rlf-204"]]),
    statesDirByChange: new Map([[changeName, "/wt/rlf-204/.ralph"]]),
    branchByChange: new Map([[changeName, "ralph/rlf-204"]]),
    issueByChange: new Map([[changeName, makeIssue()]]),
  };
}

const CHANGE = "rlf-204-subtask-progress";

describe("releaseChangeWorktreeMaps", () => {
  // bug_case → flipped to a regression guard after the fix.
  //
  // Pre-fix this asserted the BROKEN behavior: an awaiting-confirmation exit
  // deleted the worktree maps. That deletion runs (worker.ts) before the
  // coordinator's post-reap `syncTasks` flush, so the flush resolves the change
  // dir via `cwdByChange.get() ?? projectRoot` -> the main checkout, where the
  // worktree-only design.md does not exist -> "missing, skipping", no upload
  // (RLF-204). Post-fix the maps must survive an awaiting exit.
  test("retains worktree maps when the exit parks the change in awaiting-confirmation", () => {
    const maps = makeMaps(CHANGE);
    releaseChangeWorktreeMaps(CHANGE, maps, { awaitingConfirmation: true });
    expect(maps.cwdByChange.has(CHANGE)).toBe(true);
    expect(maps.issueByChange.has(CHANGE)).toBe(true);
    expect(maps.statesDirByChange.has(CHANGE)).toBe(true);
    expect(maps.branchByChange.has(CHANGE)).toBe(true);
  });

  // fix_case: a terminal (non-awaiting) exit still releases everything so the
  // maps don't leak once the change is truly finished.
  test("releases all worktree maps on a terminal (non-awaiting) exit", () => {
    const maps = makeMaps(CHANGE);
    releaseChangeWorktreeMaps(CHANGE, maps, { awaitingConfirmation: false });
    expect(maps.cwdByChange.has(CHANGE)).toBe(false);
    expect(maps.issueByChange.has(CHANGE)).toBe(false);
    expect(maps.statesDirByChange.has(CHANGE)).toBe(false);
    expect(maps.branchByChange.has(CHANGE)).toBe(false);
  });
});
