import { afterEach, describe, expect, test } from "bun:test";
import {
  fetchOpenIssues,
  fetchMentionScanIssues,
} from "../shared/capabilities/linear-client/issues";
import { formatBlockedCell } from "../list/formatting";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

function stubFetch(data: unknown): void {
  (globalThis as { fetch: unknown }).fetch = async (_url: unknown, _init?: RequestInit) => {
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// Tests author blockers in the intuitive `blocked_by` / `relatedIssue` shape;
// real Linear exposes the blocked-by direction only via `inverseRelations`
// (stored type `blocks`, `issue` = the blocker). Translate here so the fixtures
// read naturally while exercising the exact shape the client parses.
function makeRelations(
  nodes: {
    type: string;
    relatedIssue: { id: string; identifier: string; state: { type: string } };
  }[],
) {
  return {
    nodes: nodes.map((n) => ({
      type: n.type === "blocked_by" ? "blocks" : n.type,
      issue: n.relatedIssue,
    })),
  };
}

function makeIssueNode(inverseRelations = makeRelations([])) {
  return {
    id: "i1",
    identifier: "ENG-1",
    title: "Test",
    description: null,
    url: "https://linear.app/x/ENG-1",
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels: { nodes: [] },
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    inverseRelations,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch as FetchLike as typeof fetch;
});

// ---------------------------------------------------------------------------
// (a) blockedByIdentifiers excludes completed/cancelled blockers
// ---------------------------------------------------------------------------

describe("blockedByIdentifiers — completed/cancelled blockers excluded", () => {
  test("fetchOpenIssues excludes completed blockers from blockedByIdentifiers", async () => {
    stubFetch({
      issues: {
        nodes: [
          makeIssueNode(
            makeRelations([
              {
                type: "blocked_by",
                relatedIssue: { id: "id-open", identifier: "ENG-10", state: { type: "started" } },
              },
              {
                type: "blocked_by",
                relatedIssue: { id: "id-done", identifier: "ENG-11", state: { type: "completed" } },
              },
              {
                type: "blocked_by",
                relatedIssue: {
                  id: "id-cancelled",
                  identifier: "ENG-12",
                  state: { type: "cancelled" },
                },
              },
            ]),
          ),
        ],
      },
    });
    const issues = await fetchOpenIssues("k", {});
    expect(issues[0]!.blockedByIdentifiers).toEqual(["ENG-10"]);
  });

  test("fetchMentionScanIssues excludes cancelled blockers from blockedByIdentifiers", async () => {
    const nodeWithComments = {
      ...makeIssueNode(
        makeRelations([
          {
            type: "blocked_by",
            relatedIssue: { id: "id-open", identifier: "ENG-20", state: { type: "unstarted" } },
          },
          {
            type: "blocked_by",
            relatedIssue: { id: "id-cancel", identifier: "ENG-21", state: { type: "cancelled" } },
          },
        ]),
      ),
      comments: { nodes: [] },
    };
    stubFetch({ issues: { nodes: [nodeWithComments] } });
    const issues = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    });
    expect(issues[0]!.blockedByIdentifiers).toEqual(["ENG-20"]);
  });
});

// ---------------------------------------------------------------------------
// (b) open blockers appear in blockedByIdentifiers
// ---------------------------------------------------------------------------

describe("blockedByIdentifiers — open blockers listed", () => {
  test("fetchOpenIssues includes all open blocked_by relations", async () => {
    stubFetch({
      issues: {
        nodes: [
          makeIssueNode(
            makeRelations([
              {
                type: "blocked_by",
                relatedIssue: { id: "a", identifier: "ENG-30", state: { type: "unstarted" } },
              },
              {
                type: "blocked_by",
                relatedIssue: { id: "b", identifier: "ENG-31", state: { type: "started" } },
              },
              {
                type: "duplicate_of",
                relatedIssue: { id: "c", identifier: "ENG-32", state: { type: "started" } },
              },
            ]),
          ),
        ],
      },
    });
    const issues = await fetchOpenIssues("k", {});
    expect(issues[0]!.blockedByIdentifiers).toEqual(["ENG-30", "ENG-31"]);
  });

  test("fetchOpenIssues returns empty blockedByIdentifiers when no blockers", async () => {
    stubFetch({ issues: { nodes: [makeIssueNode()] } });
    const issues = await fetchOpenIssues("k", {});
    expect(issues[0]!.blockedByIdentifiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (c) column renders "-" for unblocked rows and identifiers for blocked rows
// ---------------------------------------------------------------------------

describe("formatBlockedCell", () => {
  test("returns '-' when blockedByIdentifiers is empty", () => {
    expect(formatBlockedCell([])).toBe("-");
  });

  test("returns the single identifier for one blocker", () => {
    expect(formatBlockedCell(["ENG-42"])).toBe("ENG-42");
  });

  test("returns comma-separated identifiers for multiple blockers", () => {
    expect(formatBlockedCell(["ENG-1", "ENG-2", "ENG-3"])).toBe("ENG-1, ENG-2, ENG-3");
  });
});
