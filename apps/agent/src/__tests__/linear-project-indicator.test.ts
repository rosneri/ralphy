import { afterEach, describe, expect, test } from "bun:test";
import { fetchOpenIssues, issueMatchesGetIndicator } from "../agent/linear";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

function stubFetch(
  handler: (body: { query: string; variables: Record<string, unknown> }) => unknown,
): { calls: { query: string; variables: Record<string, unknown> }[] } {
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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("issueMatchesGetIndicator with project markers", () => {
  test("matches issue.project.name case-insensitively", () => {
    const issue = {
      labels: [],
      state: { name: "Todo", type: "unstarted" },
      project: { id: "p1", name: "Ralph Queue" },
    };
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "project", value: "ralph queue" }],
      }),
    ).toBe(true);
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "project", value: "Ralph Queue" }],
      }),
    ).toBe(true);
  });

  test("returns false when issue has no project", () => {
    const issue = {
      labels: [],
      state: { name: "Todo", type: "unstarted" },
      project: null,
    };
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "project", value: "Ralph Queue" }],
      }),
    ).toBe(false);
  });

  test("returns false when project name differs", () => {
    const issue = {
      labels: [],
      state: { name: "Todo", type: "unstarted" },
      project: { id: "p2", name: "Other Project" },
    };
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "project", value: "Ralph Queue" }],
      }),
    ).toBe(false);
  });
});

describe("buildIssueFilter (via fetchOpenIssues) with project markers", () => {
  test("emits project.name.in for include project marker", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      include: [{ type: "project", value: "Ralph Queue" }],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter).toEqual({
      project: { name: { in: ["Ralph Queue"] } },
    });
  });

  test("emits project.name.nin for exclude project marker", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      exclude: [{ type: "project", value: "Archive" }],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ name: { nin: ["Archive"] } });
    expect(filter.state).toEqual({ type: { in: ["unstarted", "started", "backlog"] } });
  });

  test("merges include + exclude project markers via and:", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      include: [{ type: "project", value: "Ralph Queue" }],
      exclude: [{ type: "project", value: "Archive" }],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.project).toBeUndefined();
    expect(filter.and).toEqual([
      { project: { name: { in: ["Ralph Queue"] } } },
      { project: { name: { nin: ["Archive"] } } },
    ]);
  });
});
