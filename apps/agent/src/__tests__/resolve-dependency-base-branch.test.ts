import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolveDependencyBaseBranchImpl } from "../agent/wire";
import { createFakeCodeHost } from "@ralphy/codehost/testing";
import type { CodeHost, PullRequestState } from "@ralphy/codehost";
import type { TrackedIssue } from "@ralphy/tracker";

const ISSUE_ID = "dep-issue";

function issueWithBlockers(ids: string[]): TrackedIssue {
  return {
    id: ISSUE_ID,
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

type BlockerSpec = { id: string; identifier?: string };
type AttachmentSpec = { url: string };

/**
 * A `globalThis.fetch` stand-in that answers the two Linear GraphQL queries the
 * resolver issues — `IssuesBlockedBy` (relations) and `IssuesAttachments` — by
 * dispatching on the query body. `blockedBy`/`attachments` map an issue id to
 * its data; unknown ids return empty.
 */
function makeLinearMock(opts: {
  blockedBy?: Record<string, BlockerSpec[]>;
  attachments?: Record<string, AttachmentSpec[]>;
  blockedByStatus?: number;
  attachmentsStatus?: number;
  onCall?: (kind: "blockedBy" | "attachments", ids: string[]) => void;
}): typeof fetch {
  const impl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      query: string;
      variables: { ids: string[] };
    };
    const ids = body.variables.ids;
    if (body.query.includes("IssuesBlockedBy")) {
      opts.onCall?.("blockedBy", ids);
      if (opts.blockedByStatus && opts.blockedByStatus >= 400) {
        return new Response("blocked-by boom", { status: opts.blockedByStatus });
      }
      const nodes = ids.map((id) => ({
        id,
        inverseRelations: {
          nodes: (opts.blockedBy?.[id] ?? []).map((b) => ({
            type: "blocks",
            issue: {
              id: b.id,
              identifier: b.identifier ?? b.id.toUpperCase(),
              state: { type: "started" },
            },
          })),
        },
      }));
      return new Response(JSON.stringify({ data: { issues: { nodes } } }), { status: 200 });
    }
    if (body.query.includes("IssuesAttachments")) {
      opts.onCall?.("attachments", ids);
      if (opts.attachmentsStatus && opts.attachmentsStatus >= 400) {
        return new Response("attachments boom", { status: opts.attachmentsStatus });
      }
      const nodes = ids.map((id) => ({
        id,
        attachments: {
          nodes: (opts.attachments?.[id] ?? []).map((a, i) => ({
            id: `att-${id}-${i}`,
            url: a.url,
            sourceType: "github",
            title: "feat",
          })),
        },
      }));
      return new Response(JSON.stringify({ data: { issues: { nodes } } }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  return Object.assign(impl, { preconnect: () => {} });
}

/** A CodeHost whose `getPullRequestDetails` answers from a url → PR-fields map.
 *  Unknown URLs resolve to a closed PR (mirrors a missing/landed attachment). */
function makeHost(
  prs: Record<string, { state: PullRequestState; headRefName: string; title: string }>,
  probed?: string[],
): CodeHost {
  const host = createFakeCodeHost();
  return {
    ...host,
    async getPullRequestDetails(url) {
      probed?.push(url);
      const pr = prs[url];
      if (!pr) return { state: "closed", headRefName: "", title: "", url };
      return { ...pr, url };
    },
  };
}

describe("resolveDependencyBaseBranchImpl", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("single blocker with one open PR resolves to that PR's head branch", async () => {
    const prUrl = "https://github.com/owner/repo/pull/777";
    globalThis.fetch = makeLinearMock({
      blockedBy: { [ISSUE_ID]: [{ id: "b3" }] },
      attachments: { b3: [{ url: prUrl }] },
    });
    const host = makeHost({
      [prUrl]: { state: "open", headRefName: "feature/blocker-3", title: "RLF-42: build it" },
    });

    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers(["b3"]), host, {
      apiKey: "k",
      onLog: () => {},
    });

    expect(out).toEqual({
      baseBranch: "feature/blocker-3",
      prUrl,
      prNumber: 777,
      blockerIdentifier: "RLF-42",
    });
  });

  test("re-resolves blockers live: stale empty snapshot still stacks (gap #1)", async () => {
    // Snapshot captured at spawn has NO blockers, but Linear now reports one
    // with an open PR. The live re-fetch must pick it up.
    const prUrl = "https://github.com/owner/repo/pull/501";
    globalThis.fetch = makeLinearMock({
      blockedBy: { [ISSUE_ID]: [{ id: "late" }] },
      attachments: { late: [{ url: prUrl }] },
    });
    const host = makeHost({
      [prUrl]: { state: "open", headRefName: "ralph/late", title: "RLF-7: late link" },
    });

    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers([]), host, {
      apiKey: "k",
      onLog: () => {},
    });

    expect(out?.baseBranch).toBe("ralph/late");
    expect(out?.blockerIdentifier).toBe("RLF-7");
  });

  test("chain of blockers with open PRs stacks onto the tip, not main (gap #2)", async () => {
    // dep-issue blocked by both b418 and b419; b419 is itself blocked by b418.
    // The tip is b419 (most downstream) — stack onto its branch.
    const pr418 = "https://github.com/owner/repo/pull/418";
    const pr419 = "https://github.com/owner/repo/pull/419";
    globalThis.fetch = makeLinearMock({
      blockedBy: {
        [ISSUE_ID]: [{ id: "b418" }, { id: "b419" }],
        b418: [],
        b419: [{ id: "b418" }],
      },
      attachments: { b418: [{ url: pr418 }], b419: [{ url: pr419 }] },
    });
    const host = makeHost({
      [pr418]: { state: "open", headRefName: "ralph/lit-418", title: "LIT-418: schema" },
      [pr419]: { state: "open", headRefName: "ralph/lit-419", title: "LIT-419: read/write" },
    });

    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers(["b418", "b419"]), host, {
      apiKey: "k",
      onLog: () => {},
    });

    expect(out?.baseBranch).toBe("ralph/lit-419");
    expect(out?.blockerIdentifier).toBe("LIT-419");
  });

  test("genuinely independent blockers with open PRs have no tip → null", async () => {
    const prA = "https://github.com/owner/repo/pull/10";
    const prB = "https://github.com/owner/repo/pull/20";
    globalThis.fetch = makeLinearMock({
      blockedBy: { [ISSUE_ID]: [{ id: "ba" }, { id: "bb" }], ba: [], bb: [] },
      attachments: { ba: [{ url: prA }], bb: [{ url: prB }] },
    });
    const host = makeHost({
      [prA]: { state: "open", headRefName: "ralph/a", title: "RLF-1: a" },
      [prB]: { state: "open", headRefName: "ralph/b", title: "RLF-2: b" },
    });
    const logs: { msg: string; color?: string | undefined }[] = [];

    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers(["ba", "bb"]), host, {
      apiKey: "k",
      onLog: (msg, color) => logs.push({ msg, color }),
    });

    expect(out).toBeNull();
    expect(logs.some((l) => l.msg.includes("no single dependency tip"))).toBe(true);
  });

  test("live blocker fetch failure falls back to the spawn snapshot", async () => {
    const prUrl = "https://github.com/owner/repo/pull/55";
    globalThis.fetch = makeLinearMock({
      blockedByStatus: 500, // live re-fetch fails → fall back to snapshot ["b1"]
      attachments: { b1: [{ url: prUrl }] },
    });
    const host = makeHost({
      [prUrl]: { state: "open", headRefName: "ralph/b1", title: "RLF-3: snap" },
    });
    const logs: { msg: string; color?: string | undefined }[] = [];

    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers(["b1"]), host, {
      apiKey: "k",
      onLog: (msg, color) => logs.push({ msg, color }),
    });

    expect(out?.baseBranch).toBe("ralph/b1");
    expect(logs.some((l) => l.color === "yellow" && l.msg.includes("refresh blockers"))).toBe(true);
  });

  test("attachment fetch failure logs yellow and returns null", async () => {
    globalThis.fetch = makeLinearMock({
      blockedBy: { [ISSUE_ID]: [{ id: "b1" }, { id: "b2" }] },
      attachmentsStatus: 500,
    });
    const host = makeHost({});
    const logs: { msg: string; color?: string | undefined }[] = [];

    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers(["b1", "b2"]), host, {
      apiKey: "k",
      onLog: (msg, color) => logs.push({ msg, color }),
    });

    expect(out).toBeNull();
    const yellow = logs.filter((l) => l.color === "yellow");
    expect(yellow).toHaveLength(1);
    expect(yellow[0]!.msg).toContain("RLF-99");
    expect(yellow[0]!.msg).toContain("attachments for blockers");
  });

  test("no blockers (live + snapshot empty) returns null after one lookup", async () => {
    const calls: string[] = [];
    globalThis.fetch = makeLinearMock({
      blockedBy: { [ISSUE_ID]: [] },
      onCall: (kind) => calls.push(kind),
    });
    const host = makeHost({});

    const out = await resolveDependencyBaseBranchImpl(issueWithBlockers([]), host, {
      apiKey: "k",
      onLog: () => {},
    });

    expect(out).toBeNull();
    // One blocked-by lookup; no attachment fetch since there are no blockers.
    expect(calls).toEqual(["blockedBy"]);
  });
});
