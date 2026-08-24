import { afterEach, describe, expect, test } from "bun:test";
import { fetchMentionScanIssues, fetchOpenIssues } from "../shared/capabilities/linear-client";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

/** Capture the GraphQL query text alongside stubbing the response. */
function stubFetch(data: unknown, sentQueries: string[] = []): string[] {
  (globalThis as { fetch: unknown }).fetch = async (_url: unknown, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    sentQueries.push(body);
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return sentQueries;
}

function issueNode(cycle: unknown) {
  return {
    id: "i1",
    identifier: "ENG-1",
    title: "Test",
    description: null,
    url: "https://linear.app/x/ENG-1",
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    projectMilestone: null,
    cycle,
    labels: { nodes: [] },
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    inverseRelations: { nodes: [] },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch as FetchLike as typeof fetch;
});

describe("Linear client — cycle mapping", () => {
  test("fetchOpenIssues maps a full cycle node and requests the cycle selection", async () => {
    const queries = stubFetch({
      issues: {
        nodes: [
          issueNode({
            id: "c1",
            number: 7,
            name: "Cycle 7",
            startsAt: "2026-03-01T00:00:00.000Z",
            endsAt: "2026-03-15T00:00:00.000Z",
          }),
        ],
      },
    });

    const issues = await fetchOpenIssues("key", {});

    expect(issues[0]!.cycle).toEqual({
      id: "c1",
      number: 7,
      name: "Cycle 7",
      startsAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-03-15T00:00:00.000Z",
    });
    expect(queries[0]).toContain("cycle { id number name startsAt endsAt }");
  });

  test("fetchOpenIssues omits cycle when the node has none", async () => {
    stubFetch({ issues: { nodes: [issueNode(null)] } });

    const issues = await fetchOpenIssues("key", {});

    expect(issues[0]!.cycle).toBeUndefined();
    expect("cycle" in issues[0]!).toBe(false);
  });

  test("cycle name and endsAt are omitted when null", async () => {
    stubFetch({
      issues: {
        nodes: [
          issueNode({
            id: "c2",
            number: 8,
            name: null,
            startsAt: "2026-04-01T00:00:00.000Z",
            endsAt: null,
          }),
        ],
      },
    });

    const issues = await fetchOpenIssues("key", {});

    expect(issues[0]!.cycle).toEqual({ id: "c2", number: 8, startsAt: "2026-04-01T00:00:00.000Z" });
  });

  test("fetchMentionScanIssues maps cycle too", async () => {
    const queries = stubFetch({
      issues: {
        nodes: [
          {
            ...issueNode({
              id: "c3",
              number: 9,
              name: "Cycle 9",
              startsAt: "2026-05-01T00:00:00.000Z",
              endsAt: null,
            }),
            comments: { nodes: [] },
          },
        ],
      },
    });

    const issues = await fetchMentionScanIssues("key", {
      indicators: { setDone: { type: "status", value: "Done" } },
    });

    expect(issues[0]!.cycle?.startsAt).toBe("2026-05-01T00:00:00.000Z");
    expect(queries[0]).toContain("cycle { id number name startsAt endsAt }");
  });
});
