import { afterEach, describe, expect, test } from "bun:test";
import {
  baseBranchFromLabels,
  createIssue,
  findOpenIssueByLabel,
  issueMatchesGetIndicator,
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
