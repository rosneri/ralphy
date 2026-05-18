import { afterEach, describe, expect, test } from "bun:test";
import {
  baseBranchFromLabels,
  createIssue,
  fetchMentionScanIssues,
  findOpenIssueByLabel,
  formatLinearError,
  issueMatchesGetIndicator,
  linearRequestInternals,
  updateIssueDescription,
} from "../agent/linear";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;
function stubFetch(
  handler: (body: { query: string; variables: Record<string, unknown> }) => unknown,
): {
  calls: { query: string; variables: Record<string, unknown> }[];
} {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const fakeFetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query: string;
      variables: Record<string, unknown>;
    };
    calls.push(body);
    const data = handler(body);
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  return { calls };
}

describe("baseBranchFromLabels", () => {
  test("returns the suffix when a ralph:branch:<name> label is present", () => {
    expect(baseBranchFromLabels(["ralph:branch:release/2026"])).toBe("release/2026");
  });

  test("prefix match is case-insensitive but suffix preserves casing", () => {
    expect(baseBranchFromLabels(["Ralph:Branch:Release-XYZ"])).toBe("Release-XYZ");
  });

  test("returns undefined when no matching label is present", () => {
    expect(baseBranchFromLabels(["ralph:review", "other"])).toBeUndefined();
    expect(baseBranchFromLabels([])).toBeUndefined();
  });

  test("trims whitespace and ignores empty suffix", () => {
    expect(baseBranchFromLabels(["ralph:branch:  feat-x  "])).toBe("feat-x");
    expect(baseBranchFromLabels(["ralph:branch:"])).toBeUndefined();
  });
});

describe("issueMatchesGetIndicator", () => {
  const issue = {
    labels: ["ralph:auto-merge"],
    state: { name: "In Progress", type: "started" },
  };

  test("returns false when indicator is undefined or empty", () => {
    expect(issueMatchesGetIndicator(issue, undefined)).toBe(false);
    expect(issueMatchesGetIndicator(issue, { filter: [] })).toBe(false);
  });

  test("matches against a label marker (case-insensitive)", () => {
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "label", value: "RALPH:AUTO-MERGE" }],
      }),
    ).toBe(true);
  });

  test("matches against a status marker", () => {
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "status", value: "in progress" }],
      }),
    ).toBe(true);
  });

  test("returns false when nothing matches", () => {
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "label", value: "ralph:review" }],
      }),
    ).toBe(false);
  });
});

describe("createIssue / updateIssueDescription / findOpenIssueByLabel", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("createIssue posts the right input and returns id+identifier", async () => {
    const { calls } = stubFetch(() => ({
      issueCreate: { success: true, issue: { id: "abc", identifier: "RLF-99" } },
    }));
    const out = await createIssue("k", {
      teamId: "team-1",
      title: "Trunk is broken",
      description: "x",
      labelIds: ["lbl-1"],
    });
    expect(out).toEqual({ id: "abc", identifier: "RLF-99" });
    expect(calls[0]!.variables.input).toMatchObject({
      teamId: "team-1",
      title: "Trunk is broken",
      description: "x",
      labelIds: ["lbl-1"],
    });
  });

  test("createIssue throws when issue is null", async () => {
    stubFetch(() => ({ issueCreate: { success: false, issue: null } }));
    await expect(createIssue("k", { teamId: "t", title: "x", description: "y" })).rejects.toThrow();
  });

  test("updateIssueDescription threads id+description", async () => {
    const { calls } = stubFetch(() => ({ issueUpdate: { success: true } }));
    await updateIssueDescription("k", "iss-1", "new body");
    expect(calls[0]!.variables).toEqual({ id: "iss-1", description: "new body" });
  });

  test("findOpenIssueByLabel returns the first node or null", async () => {
    stubFetch(() => ({
      issues: { nodes: [{ id: "i1", identifier: "RLF-1", description: "body" }] },
    }));
    const r = await findOpenIssueByLabel("k", "RLF", "ralph:pre-existing-error");
    expect(r).toEqual({ id: "i1", identifier: "RLF-1", description: "body" });

    stubFetch(() => ({ issues: { nodes: [] } }));
    const none = await findOpenIssueByLabel("k", "RLF", "x");
    expect(none).toBeNull();
  });
});

describe("linearRequest retry (RLF-60)", () => {
  const originalSleep = linearRequestInternals.sleep;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    linearRequestInternals.sleep = originalSleep;
  });

  function stubResponses(responses: Response[]): { count: () => number } {
    let i = 0;
    const fakeFetch: FetchLike = async () => {
      const r = responses[i++];
      if (!r) throw new Error(`unexpected extra fetch call (#${i})`);
      return r;
    };
    globalThis.fetch = fakeFetch as typeof fetch;
    linearRequestInternals.sleep = async () => {};
    return { count: () => i };
  }

  function okResponse(data: unknown): Response {
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function errResponse(status: number, body = ""): Response {
    return new Response(body, { status });
  }

  test("retries 429 then succeeds on the second attempt", async () => {
    const { count } = stubResponses([errResponse(429), okResponse({ issues: { nodes: [] } })]);
    await fetchMentionScanIssues("k", {});
    expect(count()).toBe(2);
  });

  test("retries 503 then succeeds", async () => {
    const { count } = stubResponses([errResponse(503), okResponse({ issues: { nodes: [] } })]);
    await fetchMentionScanIssues("k", {});
    expect(count()).toBe(2);
  });

  test("does NOT retry 404", async () => {
    const { count } = stubResponses([errResponse(404, "not found")]);
    await expect(fetchMentionScanIssues("k", {})).rejects.toMatchObject({ status: 404 });
    expect(count()).toBe(1);
  });

  test("gives up after 3 429s and rejects with status 429", async () => {
    const { count } = stubResponses([errResponse(429), errResponse(429), errResponse(429)]);
    await expect(fetchMentionScanIssues("k", {})).rejects.toMatchObject({ status: 429 });
    expect(count()).toBe(3);
  });
});

describe("formatLinearError (RLF-60)", () => {
  test("formats HTTP errors with status + body", () => {
    const err = Object.assign(new Error("Linear API request failed"), {
      status: 500,
      body: "boom",
    });
    const msg = formatLinearError(err);
    expect(msg).toContain("HTTP 500");
    expect(msg).toContain("boom");
  });

  test("truncates body to 200 chars", () => {
    const err = Object.assign(new Error("x"), {
      status: 500,
      body: "a".repeat(500),
    });
    const msg = formatLinearError(err);
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(400);
  });

  test("formats GraphQL errors with messages", () => {
    const err = Object.assign(new Error("Linear API returned errors"), {
      messages: ["bad field", "missing var"],
    });
    const msg = formatLinearError(err);
    expect(msg).toContain("graphql:");
    expect(msg).toContain("bad field");
    expect(msg).toContain("missing var");
  });

  test("falls back to message for plain errors", () => {
    expect(formatLinearError(new Error("plain"))).toBe("plain");
  });

  test("falls back to String() for non-Error values", () => {
    expect(formatLinearError("oops")).toBe("oops");
    expect(formatLinearError(undefined)).toBe("undefined");
  });
});

describe("fetchMentionScanIssues (RLF-55)", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("filter includes unstarted/started/backlog/triage/completed (excludes cancelled)", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchMentionScanIssues("k", { team: "RLF", assignee: "me" });
    const filter = calls[0]!.variables.filter as {
      state: { type: { in: string[] } };
      team: { key: { eq: string } };
      assignee: { isMe: { eq: boolean } };
    };
    expect(filter.state.type.in).toEqual([
      "unstarted",
      "started",
      "backlog",
      "triage",
      "completed",
    ]);
    expect(filter.state.type.in).not.toContain("cancelled");
    expect(filter.team).toEqual({ key: { eq: "RLF" } });
    expect(filter.assignee).toEqual({ isMe: { eq: true } });
  });

  test("assignee email and id forms are routed correctly", async () => {
    const seen: Record<string, unknown>[] = [];
    const { calls } = stubFetch((body) => {
      seen.push(body.variables.filter as Record<string, unknown>);
      return { issues: { nodes: [] } };
    });
    await fetchMentionScanIssues("k", { assignee: "user@example.com" });
    await fetchMentionScanIssues("k", { assignee: "user-id-xyz" });
    expect(calls).toHaveLength(2);
    expect(seen[0]!.assignee).toEqual({ email: { eq: "user@example.com" } });
    expect(seen[1]!.assignee).toEqual({ id: { eq: "user-id-xyz" } });
  });

  test("maps nodes into LinearIssue shape and filters Done blockers", async () => {
    stubFetch(() => ({
      issues: {
        nodes: [
          {
            id: "i1",
            identifier: "RLF-1",
            title: "t",
            description: "d",
            url: "u",
            priority: 1,
            createdAt: "2026-01-01",
            state: { name: "In Progress", type: "started" },
            assignee: { id: "a", email: "a@a", name: "A" },
            labels: { nodes: [{ name: "x" }, { name: "y" }] },
            relations: {
              nodes: [
                {
                  type: "blocked_by",
                  relatedIssue: { id: "blocker-open", state: { type: "started" } },
                },
                {
                  type: "blocked_by",
                  relatedIssue: { id: "blocker-done", state: { type: "completed" } },
                },
                {
                  type: "duplicate_of",
                  relatedIssue: { id: "ignored", state: { type: "started" } },
                },
              ],
            },
          },
        ],
      },
    }));
    const issues = await fetchMentionScanIssues("k", {});
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: "i1",
      identifier: "RLF-1",
      labels: ["x", "y"],
      blockedByIds: ["blocker-open"],
    });
  });
});
