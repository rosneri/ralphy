import { afterEach, describe, expect, test } from "bun:test";
import { createLinearResolvers } from "../agent/wire/linear-resolvers";
import type { LinearIssue } from "../agent/linear";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

interface Captured {
  query: string;
  variables: Record<string, unknown>;
}

function stubFetch(handler: (body: Captured) => unknown): { calls: Captured[] } {
  const calls: Captured[] = [];
  const fakeFetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Captured;
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

const RLF_1 = { identifier: "RLF-1", id: "issue-1" } as LinearIssue;

function defaultLabelsHandler(body: Captured): unknown {
  if (body.query.includes("issueLabelCreate")) {
    // Linear rejects when the label already exists with this name. The
    // resolver should never reach this branch when `group` is provided —
    // we assert that with `calls.some(...)` rather than throwing here so a
    // misroute doesn't dirty up globalThis.fetch error state for other
    // test files running in parallel.
    return { issueLabelCreate: { success: false, issueLabel: null } };
  }
  if (body.query.includes("issueLabels")) {
    const isWorkspace = body.query.includes("WorkspaceLabels");
    return {
      issueLabels: {
        nodes: isWorkspace
          ? []
          : [{ id: "lbl-ralphy-error", name: "error", parent: { name: "Ralphy" } }],
      },
    };
  }
  if (body.query.includes("teams(filter")) {
    return { teams: { nodes: [{ id: "team-rlf-id" }] } };
  }
  return {};
}

describe("resolveLabelId — group-scoped lookup", () => {
  test("fix_case: resolves nested label by (value, group) without attempting create", async () => {
    const { calls } = stubFetch(defaultLabelsHandler);
    const resolvers = createLinearResolvers({
      apiKey: "k",
      team: "RLF",
      assignee: undefined,
      diag: () => {},
    });
    const id = await resolvers.resolveLabelId(RLF_1, "error", "Ralphy");
    expect(id).toBe("lbl-ralphy-error");
    expect(calls.some((c) => c.query.includes("issueLabelCreate"))).toBe(false);
  });

  test("group lookup is case-insensitive for both group and value", async () => {
    stubFetch(defaultLabelsHandler);
    const resolvers = createLinearResolvers({
      apiKey: "k",
      team: "RLF",
      assignee: undefined,
      diag: () => {},
    });
    const id = await resolvers.resolveLabelId(RLF_1, "ERROR", "ralphy");
    expect(id).toBe("lbl-ralphy-error");
  });

  test("applying a grouped label swaps out a sibling from the same exclusive group", async () => {
    // The issue already carries `approved` (group "Ralphy"); applying `error`
    // from the same exclusive group must remove `approved` first, then add
    // `error` — otherwise Linear rejects the second add.
    const groupedLabelsHandler = (body: Captured): unknown => {
      if (body.query.includes("issueLabels")) {
        const isWorkspace = body.query.includes("WorkspaceLabels");
        return {
          issueLabels: {
            nodes: isWorkspace
              ? []
              : [
                  { id: "lbl-ralphy-error", name: "error", parent: { name: "Ralphy" } },
                  { id: "lbl-ralphy-approved", name: "approved", parent: { name: "Ralphy" } },
                ],
          },
        };
      }
      if (body.query.includes("issueAddLabel")) return { issueAddLabel: { success: true } };
      if (body.query.includes("issueRemoveLabel")) return { issueRemoveLabel: { success: true } };
      if (body.query.includes("teams(filter")) return { teams: { nodes: [{ id: "team-rlf-id" }] } };
      return {};
    };
    const { calls } = stubFetch(groupedLabelsHandler);
    const resolvers = createLinearResolvers({
      apiKey: "k",
      team: "RLF",
      assignee: undefined,
      diag: () => {},
    });

    const issue = { identifier: "RLF-1", id: "issue-1", labels: ["approved"] } as LinearIssue;
    await resolvers.applyMarker(issue, { type: "label", value: "error", group: "Ralphy" });

    const removed = calls.find((c) => c.query.includes("issueRemoveLabel"));
    const added = calls.find((c) => c.query.includes("issueAddLabel"));
    expect(removed?.variables).toMatchObject({ id: "issue-1", labelId: "lbl-ralphy-approved" });
    expect(added?.variables).toMatchObject({ id: "issue-1", labelId: "lbl-ralphy-error" });
    // The label we are adding must not be removed as a "sibling".
    expect(
      calls.some(
        (c) =>
          c.query.includes("issueRemoveLabel") && c.variables["labelId"] === "lbl-ralphy-error",
      ),
    ).toBe(false);
  });

  test("a grouped label with no conflicting sibling is added without any removal", async () => {
    const { calls } = stubFetch(defaultLabelsHandler);
    const resolvers = createLinearResolvers({
      apiKey: "k",
      team: "RLF",
      assignee: undefined,
      diag: () => {},
    });
    // Issue carries an unrelated, ungrouped label — nothing to swap.
    const issue = { identifier: "RLF-1", id: "issue-1", labels: ["Bug"] } as LinearIssue;
    await resolvers.applyMarker(issue, { type: "label", value: "error", group: "Ralphy" });

    expect(calls.some((c) => c.query.includes("issueRemoveLabel"))).toBe(false);
  });

  test("without group, callers still resolve top-level labels by exact name", async () => {
    // The no-group code path is unchanged for top-level labels — guard that
    // we still hit the cache on the bare key when the label isn't nested.
    let createAttempted = false;
    stubFetch((body) => {
      if (body.query.includes("issueLabelCreate")) {
        createAttempted = true;
        return { issueLabelCreate: { success: false, issueLabel: null } };
      }
      if (body.query.includes("issueLabels")) {
        const isWorkspace = body.query.includes("WorkspaceLabels");
        return {
          issueLabels: {
            nodes: isWorkspace ? [] : [{ id: "lbl-top", name: "ralph:error", parent: null }],
          },
        };
      }
      if (body.query.includes("teams(filter")) {
        return { teams: { nodes: [{ id: "team-rlf-id" }] } };
      }
      return {};
    });
    const resolvers = createLinearResolvers({
      apiKey: "k",
      team: "RLF",
      assignee: undefined,
      diag: () => {},
    });
    const id = await resolvers.resolveLabelId(RLF_1, "ralph:error");
    expect(id).toBe("lbl-top");
    expect(createAttempted).toBe(false);
  });
});
