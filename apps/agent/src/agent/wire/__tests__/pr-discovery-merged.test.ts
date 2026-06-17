import { describe, expect, test } from "bun:test";
import { createPrDiscovery } from "../pr-discovery";
import { createGhCliCodeHost } from "@ralphy/codehost";
import { PollContext } from "../../../shared/capabilities/poll-context";
import { changeNameForIssue } from "../../scaffold";
import type { CmdRunner } from "../../pr";
import type { TrackedIssue } from "@ralphy/tracker";

/**
 * Quarantine-stranding regression guard. When a PR merges out-of-band (a human
 * merges it, or it merges after conflicts are resolved elsewhere) the watcher's
 * merge-state scan must still settle the ticket: `checkPrStatus` reports a
 * MERGED PR as "mergeable" so the scan's mergeable → settle-to-done / clear path
 * fires and disposes the flow actor.
 *
 * Before the fix, `waitForMergeability` collapsed MERGED into the same "closed"
 * outcome as an abandoned (CLOSED, unmerged) PR, so `checkPrStatus` returned
 * `null`, the scan did `if (!pr) continue`, and a *quarantined* actor was never
 * cleared — it stayed quarantined in memory and was re-counted on every poll
 * (the LIT-419 / LIT-425 symptom).
 */

const ISSUE: TrackedIssue = {
  id: "u1",
  identifier: "ENG-1",
  title: "Test",
  url: "https://linear.app/team/issue/ENG-1",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "Done", type: "completed" },
  assignee: null,
  project: null,
  labels: [],
};

const PR_URL = "https://github.com/owner/repo/pull/610";

/** A PR whose `gh pr view` reports it has already MERGED. */
function makeCmd(state: string): CmdRunner {
  return {
    run: async (args) => {
      const key = args.join(" ");
      if (key.startsWith("gh pr view")) {
        return {
          stdout: JSON.stringify({ state, mergeable: "UNKNOWN" }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  };
}

function makeDiscovery(state: string) {
  const prByChange = new Map<string, string>();
  prByChange.set(changeNameForIssue(ISSUE), PR_URL); // pre-seed → skip URL discovery
  const cmdRunner = makeCmd(state);
  return createPrDiscovery({
    projectRoot: "/tmp/pr-discovery-merged-test",
    cmdRunner,
    codeHost: createGhCliCodeHost({ cmdRunner, cwd: "/tmp/pr-discovery-merged-test" }),
    fetchPullRequestLinks: async () => [],
    onLog: () => {},
    diag: () => {},
    prByChange,
    getPollContext: () => new PollContext(),
  });
}

describe("createPrDiscovery — merged PR clears recovery, not stranded", () => {
  test("bug_case: a MERGED PR is reported as 'mergeable' so the scan can settle it (not null)", async () => {
    const result = await makeDiscovery("MERGED").checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "mergeable" });
  });

  test("fix_case: a CLOSED (unmerged, abandoned) PR is still null — nothing to settle", async () => {
    const result = await makeDiscovery("CLOSED").checkPrStatus(ISSUE);
    expect(result).toBeNull();
  });
});
