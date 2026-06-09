import { describe, expect, test } from "bun:test";
import { createPrDiscovery } from "../pr-discovery";
import { PollContext } from "../../../shared/capabilities/poll-context";
import { changeNameForIssue } from "../../scaffold";
import type { CmdRunner } from "../../pr";
import type { TrackedIssue } from "@ralphy/tracker";

const ISSUE: TrackedIssue = {
  id: "u1",
  identifier: "ENG-1",
  title: "Test",
  url: "https://linear.app/team/issue/ENG-1",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Review", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

const PR_URL = "https://github.com/owner/repo/pull/9";

/**
 * cmdRunner: the PR is structurally MERGEABLE/CLEAN, but its CI is still
 * IN PROGRESS — `gh pr checks` reports a single "pending" check. This is the
 * window right after a fix worker pushes and CI re-runs.
 */
function makeCmd(): CmdRunner {
  return {
    run: async (args) => {
      const key = args.join(" ");
      if (key.startsWith("gh pr view")) {
        return {
          stdout: JSON.stringify({
            state: "OPEN",
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
          }),
          stderr: "",
        };
      }
      if (key.startsWith("gh pr checks")) {
        return {
          stdout: JSON.stringify([
            {
              name: "build",
              bucket: "pending",
              link: "https://github.com/owner/repo/actions/runs/1/job/2",
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  };
}

function makeDiscovery() {
  const prByChange = new Map<string, string>();
  prByChange.set(changeNameForIssue(ISSUE), PR_URL); // pre-seed → skip URL discovery
  return createPrDiscovery({
    apiKey: "k",
    projectRoot: "/tmp/pr-discovery-pending-test",
    cmdRunner: makeCmd(),
    onLog: () => {},
    diag: () => {},
    prByChange,
    getPollContext: () => new PollContext(),
    ignoreCiChecks: [],
  });
}

/* -------------------------------------------------------------------------- *
 * RLF-97 bail-counter-defeat: a PR whose CI is still PENDING must NOT be
 * reported as "mergeable". The scan clears the pr-tracker recovery counter on
 * every "mergeable" poll (coordinator.ts), so collapsing pending → mergeable
 * resets the counter mid-recovery between each CI re-run and `maxRecoverySessions`
 * never trips. "unknown" is a no-op in the scan (no clear, no queue), so the
 * counter survives until CI actually settles to pass ("mergeable") or fail.
 * -------------------------------------------------------------------------- */
describe("createPrDiscovery — pending CI classification (RLF-97 bail-counter guard)", () => {
  test("fix_case: a PR with CI still in progress is reported as 'unknown', not 'mergeable'", async () => {
    const discovery = makeDiscovery();
    const result = await discovery.checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "unknown" });
  });

  test("bug_case (flipped): pending CI is never collapsed into 'mergeable' (the counter-clear path)", async () => {
    const discovery = makeDiscovery();
    const result = await discovery.checkPrStatus(ISSUE);
    expect(result).not.toEqual({ url: PR_URL, status: "mergeable" });
  });
});
