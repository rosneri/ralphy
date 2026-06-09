import { describe, expect, test } from "bun:test";
import { createPrDiscovery } from "../pr-discovery";
import { PollContext } from "../../../shared/capabilities/poll-context";
import { changeNameForIssue } from "../../scaffold";
import type { CmdRunner } from "../../pr";
import type { LinearIssue } from "../../linear";

/**
 * BAN-799 regression guard for the done-gate. A PR can be git-mergeable
 * (no conflicts) and CI-green yet still be a DRAFT or awaiting required
 * review approval — neither is "done". `checkPrStatus` must report such a
 * PR as "unknown" (a scan no-op) so the watcher does NOT advance the ticket
 * to done and dispose its flow actor. Only a non-draft, approved (or
 * no-review-required), CI-green, conflict-free PR is "mergeable".
 */

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

const PR_URL = "https://github.com/owner/repo/pull/799";

/**
 * cmdRunner: the PR is structurally MERGEABLE/CLEAN with green CI (no checks
 * reported → treated as pass). The `isDraft` / `reviewDecision` view (the
 * readiness probe, requested via a distinct `--json isDraft,reviewDecision`)
 * is driven by the test parameters.
 */
function makeCmd(draft: boolean, reviewDecision: string | null): CmdRunner {
  return {
    run: async (args) => {
      const key = args.join(" ");
      if (key.startsWith("gh pr view") && key.includes("isDraft")) {
        return {
          stdout: JSON.stringify({ isDraft: draft, reviewDecision }),
          stderr: "",
        };
      }
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
        return { stdout: "[]", stderr: "" }; // no checks → green
      }
      return { stdout: "", stderr: "" };
    },
  };
}

function makeDiscovery(draft: boolean, reviewDecision: string | null) {
  const prByChange = new Map<string, string>();
  prByChange.set(changeNameForIssue(ISSUE), PR_URL); // pre-seed → skip URL discovery
  return createPrDiscovery({
    apiKey: "k",
    projectRoot: "/tmp/pr-discovery-readiness-test",
    cmdRunner: makeCmd(draft, reviewDecision),
    onLog: () => {},
    diag: () => {},
    prByChange,
    getPollContext: () => new PollContext(),
    ignoreCiChecks: [],
  });
}

describe("createPrDiscovery — done-gate readiness (BAN-799)", () => {
  test("bug_case: a DRAFT PR (green, conflict-free) is held as 'unknown', not advanced to done", async () => {
    const result = await makeDiscovery(true, null).checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "unknown" });
  });

  test("bug_case: a PR awaiting required review (REVIEW_REQUIRED) is held as 'unknown'", async () => {
    // This is the exact BAN-799 shape: mergeable + green but unapproved.
    const result = await makeDiscovery(false, "REVIEW_REQUIRED").checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "unknown" });
  });

  test("bug_case: a PR with requested changes (CHANGES_REQUESTED) is held as 'unknown'", async () => {
    const result = await makeDiscovery(false, "CHANGES_REQUESTED").checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "unknown" });
  });

  test("fix_case: a non-draft, APPROVED, green PR is 'mergeable' (ready for done)", async () => {
    const result = await makeDiscovery(false, "APPROVED").checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "mergeable" });
  });

  test("fix_case: a repo with no required review (reviewDecision=null) is 'mergeable' when non-draft + green", async () => {
    const result = await makeDiscovery(false, null).checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "mergeable" });
  });

  test("readiness probe failure defaults to ready: never block done on an unreadable PR", async () => {
    // The readiness `gh pr view --json isDraft,reviewDecision` throws; the
    // mergeability + CI probes still succeed. We treat it as ready rather than
    // stranding a green, conflict-free PR in `awaiting-ci` forever.
    const prByChange = new Map<string, string>();
    prByChange.set(changeNameForIssue(ISSUE), PR_URL);
    const cmdRunner: CmdRunner = {
      run: async (args) => {
        const key = args.join(" ");
        if (key.startsWith("gh pr view") && key.includes("isDraft")) {
          throw new Error("gh: connection reset");
        }
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
        if (key.startsWith("gh pr checks")) return { stdout: "[]", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    };
    const discovery = createPrDiscovery({
      apiKey: "k",
      projectRoot: "/tmp/pr-discovery-readiness-test",
      cmdRunner,
      onLog: () => {},
      diag: () => {},
      prByChange,
      getPollContext: () => new PollContext(),
      ignoreCiChecks: [],
    });
    const result = await discovery.checkPrStatus(ISSUE);
    expect(result).toEqual({ url: PR_URL, status: "mergeable" });
  });
});
