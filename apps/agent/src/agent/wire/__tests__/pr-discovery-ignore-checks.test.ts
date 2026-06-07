import { describe, expect, test } from "bun:test";
import { createPrDiscovery } from "../pr-discovery";
import { PollContext } from "../../../shared/capabilities/poll-context";
import { changeNameForIssue } from "../../scaffold";
import type { CmdRunner } from "../../pr";
import type { LinearIssue } from "../../linear";

const ISSUE: LinearIssue = {
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

const PR_URL = "https://github.com/owner/repo/pull/7";

/** cmdRunner: PR is MERGEABLE, but its only CI check ("flaky") is failing. */
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
              name: "flaky",
              bucket: "fail",
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

function makeDiscovery(ignoreCiChecks: string[]) {
  const prByChange = new Map<string, string>();
  prByChange.set(changeNameForIssue(ISSUE), PR_URL); // pre-seed → skip URL discovery
  return createPrDiscovery({
    apiKey: "k",
    projectRoot: "/tmp/pr-discovery-test",
    cmdRunner: makeCmd(),
    onLog: () => {},
    diag: () => {},
    prByChange,
    getPollContext: () => new PollContext(),
    ignoreCiChecks,
  });
}

describe("createPrDiscovery — ignoreChecks threading (RLF-97 defect #2)", () => {
  test("a failing check listed in ignoreChecks does NOT make the watcher see ci_failed", async () => {
    const discovery = makeDiscovery(["flaky"]);
    const result = await discovery.checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "mergeable" });
  });

  test("control: without the ignore-list the same failing check yields ci_failed", async () => {
    const discovery = makeDiscovery([]);
    const result = await discovery.checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "ci_failed" });
  });
});
