import { afterEach, describe, expect, test } from "bun:test";
import { issueMatchesGetIndicator } from "../shared/capabilities/linear-client/filters";
import { fetchOpenIssues } from "../shared/capabilities/linear-client/issues";
import {
  fetchProjectIdByName,
  setIssueProject,
} from "../shared/capabilities/linear-client/labels-and-projects";

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

  test("returns false for attachment markers (no attachments on Pick)", () => {
    const issue = {
      labels: [],
      state: { name: "Todo", type: "unstarted" },
      project: null,
    };
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "attachment", value: "Ralphy" }],
      }),
    ).toBe(false);
  });
});

describe("fetchProjectIdByName", () => {
  test("returns the first project id when Linear returns a match", async () => {
    const { calls } = stubFetch(() => ({ projects: { nodes: [{ id: "proj-1" }] } }));
    const id = await fetchProjectIdByName("key", "Ralph Queue");
    expect(id).toBe("proj-1");
    expect(calls[0]?.variables).toEqual({ name: "Ralph Queue" });
  });

  test("returns null when Linear returns no nodes", async () => {
    stubFetch(() => ({ projects: { nodes: [] } }));
    expect(await fetchProjectIdByName("key", "Missing")).toBeNull();
  });
});

describe("setIssueProject", () => {
  test("sends an issueUpdate mutation with projectId", async () => {
    const { calls } = stubFetch(() => ({ issueUpdate: { success: true } }));
    await setIssueProject("key", "issue-1", "proj-1");
    expect(calls[0]?.variables).toEqual({ id: "issue-1", projectId: "proj-1" });
    expect(calls[0]?.query).toContain("issueUpdate");
  });
});

describe("buildIssueFilter (via fetchOpenIssues) with project markers", () => {
  test("emits project.name.in for include project marker (open-state-defaulted)", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      include: [{ type: "project", value: "Ralph Queue" }],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    // A project-only include carries no positive status, so the open-state
    // default applies (same guard that stops the auto-merge Done-leak).
    expect(filter).toEqual({
      project: { name: { in: ["Ralph Queue"] } },
      assignee: { null: true },
      state: { type: { in: ["unstarted", "started", "backlog"] } },
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

describe("buildIssueFilter — global project scope (requireProject)", () => {
  test("ANDs project.name.in onto a status-only bucket (getTodo)", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      anyAssignee: true,
      include: [{ type: "status", value: "Todo" }],
      requireProject: "iOS App",
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ name: { in: ["Todo"] } });
    expect(filter.project).toEqual({ name: { in: ["iOS App"] } });
  });

  test("requireProject scopes a label-only bucket (auto-merge) too", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      anyAssignee: true,
      include: [{ type: "label", value: "auto-merge", negate: false }],
      requireProject: "iOS App",
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ name: { in: ["iOS App"] } });
    expect(filter.labels).toEqual({ some: { name: { in: ["auto-merge"] } } });
  });

  test("excludeProjects / excludeLabels are ANDed onto every fetch", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      anyAssignee: true,
      include: [{ type: "status", value: "Todo" }],
      excludeProjects: ["Web"],
      excludeLabels: ["wip"],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ name: { nin: ["Web"] } });
    expect(filter.labels).toEqual({ every: { name: { nin: ["wip"] } } });
  });
});

describe("buildIssueFilter — open-state default (auto-merge Done-leak bug)", () => {
  test("a label-only include is constrained to open states (drops Done/Canceled)", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      anyAssignee: true,
      include: [{ type: "label", value: "auto-merge" }],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { in: ["unstarted", "started", "backlog"] } });
    expect(filter.labels).toEqual({ some: { name: { in: ["auto-merge"] } } });
  });

  test("an explicit status include is NOT overridden by the open-state default", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      anyAssignee: true,
      include: [{ type: "status", value: "Done" }],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ name: { in: ["Done"] } });
  });
});

describe("buildIssueFilter — marker negation in include", () => {
  test("a negated label in include becomes a must-not-have clause", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchOpenIssues("key", {
      anyAssignee: true,
      include: [
        { type: "status", value: "Todo" },
        { type: "label", value: "blocked", negate: true },
      ],
    });
    const filter = calls[0]?.variables.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ name: { in: ["Todo"] } });
    expect(filter.labels).toEqual({ every: { name: { nin: ["blocked"] } } });
  });
});

describe("issueMatchesGetIndicator — negation", () => {
  test("negated label matches when the issue does NOT carry it", () => {
    const kept = { labels: ["keep"], state: { name: "Todo", type: "unstarted" }, project: null };
    expect(
      issueMatchesGetIndicator(kept, {
        filter: [{ type: "label", value: "blocked", negate: true }],
      }),
    ).toBe(true);
    const blocked = {
      labels: ["blocked"],
      state: { name: "Todo", type: "unstarted" },
      project: null,
    };
    expect(
      issueMatchesGetIndicator(blocked, {
        filter: [{ type: "label", value: "blocked", negate: true }],
      }),
    ).toBe(false);
  });

  test("negated status matches when the issue is NOT in that state", () => {
    const todo = { labels: [], state: { name: "Todo", type: "unstarted" }, project: null };
    expect(
      issueMatchesGetIndicator(todo, { filter: [{ type: "status", value: "Done", negate: true }] }),
    ).toBe(true);
  });
});
