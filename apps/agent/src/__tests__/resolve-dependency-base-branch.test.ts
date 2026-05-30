import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolveDependencyBaseBranchImpl } from "../agent/wire";
import type { CmdRunner } from "../agent/pr";
import type { LinearIssue } from "../agent/linear";

function issueWithBlockers(ids: string[]): LinearIssue {
  return {
    id: "dep-issue",
    identifier: "RLF-99",
    title: "dep",
    description: null,
    url: "https://linear.app/x/issue/RLF-99",
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: ids,
  };
}

describe("resolveDependencyBaseBranchImpl — batched attachment fetch", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("5 blockers trigger exactly one Linear request and resolve the single open PR", async () => {
    const blockerIds = ["b1", "b2", "b3", "b4", "b5"];
    const openPrUrl = "https://github.com/owner/repo/pull/777";
    let linearCalls = 0;
    let capturedIds: string[] = [];
    const mockFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (
      _input,
      init,
    ) => {
      linearCalls += 1;
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        variables: { ids: string[] };
      };
      capturedIds = body.variables.ids;
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                // Only one blocker has the open PR attachment; the others
                // return empty attachment lists. The single-candidate branch
                // should resolve to the PR's head branch.
                {
                  id: "b3",
                  attachments: {
                    nodes: [{ id: "a1", url: openPrUrl, sourceType: "github", title: "feat" }],
                  },
                },
                { id: "b1", attachments: { nodes: [] } },
                { id: "b2", attachments: { nodes: [] } },
                { id: "b4", attachments: { nodes: [] } },
                { id: "b5", attachments: { nodes: [] } },
              ],
            },
          },
        }),
        { status: 200 },
      );
    };
    globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect });

    const ghCalls: string[][] = [];
    const runner: CmdRunner = {
      run: async (args) => {
        ghCalls.push(args);
        return {
          stdout: JSON.stringify({
            state: "OPEN",
            headRefName: "feature/blocker-3",
            title: "RLF-42: build the blocker",
            url: openPrUrl,
          }),
          stderr: "",
        };
      },
    };

    const out = await resolveDependencyBaseBranchImpl(
      issueWithBlockers(blockerIds),
      runner,
      "/cwd",
      { apiKey: "k", onLog: () => {} },
    );

    expect(linearCalls).toBe(1);
    expect(capturedIds).toEqual(blockerIds);
    expect(ghCalls).toHaveLength(1);
    // The gh pr view query must request the fields needed to name the
    // dependency clearly (ticket via title, PR via number/url).
    expect(ghCalls[0]).toContain("state,headRefName,title,url");
    expect(out).toEqual({
      baseBranch: "feature/blocker-3",
      prUrl: openPrUrl,
      prNumber: 777,
      blockerIdentifier: "RLF-42",
    });
  });

  test("batched fetch failure logs a yellow line and returns null", async () => {
    let linearCalls = 0;
    const mockFetch: (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response> = async () => {
      linearCalls += 1;
      return new Response("upstream boom", { status: 500 });
    };
    globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect });

    const logs: { msg: string; color: string | undefined }[] = [];
    const runner: CmdRunner = {
      run: async () => ({ stdout: "", stderr: "" }),
    };

    const out = await resolveDependencyBaseBranchImpl(
      issueWithBlockers(["b1", "b2"]),
      runner,
      "/cwd",
      { apiKey: "k", onLog: (msg, color) => logs.push({ msg, color }) },
    );

    expect(out).toBeNull();
    // Linear retries 5xx up to MAX_LINEAR_ATTEMPTS times, but we only care
    // that exactly one log line was emitted that references the issue
    // identifier and the "attachments for blockers" phrase.
    expect(linearCalls).toBeGreaterThanOrEqual(1);
    const yellowLines = logs.filter((l) => l.color === "yellow");
    expect(yellowLines).toHaveLength(1);
    expect(yellowLines[0]!.msg).toContain("RLF-99");
    expect(yellowLines[0]!.msg).toContain("attachments for blockers");
  });

  test("empty blockedByIds short-circuits with null and no HTTP call", async () => {
    let linearCalls = 0;
    const mockFetch: (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response> = async () => {
      linearCalls += 1;
      return new Response("{}", { status: 200 });
    };
    globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect });

    const runner: CmdRunner = { run: async () => ({ stdout: "", stderr: "" }) };
    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers([]), runner, "/cwd", {
      apiKey: "k",
      onLog: () => {},
    });
    expect(out).toBeNull();
    expect(linearCalls).toBe(0);
  });
});
