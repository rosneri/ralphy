import { afterEach, describe, expect, test } from "bun:test";
import {
  fetchMentionScanIssues,
  fetchOpenIssues,
  fetchIssueComments,
  fetchWorkflowStates,
  fetchTeamIdByKey,
  fetchIssueLabels,
  fetchIssueAttachments,
  findIssueAttachmentByTitle,
  fetchProjectIdByName,
  findOpenIssueByLabel,
  addIssueComment,
  updateIssueComment,
  deleteIssueComment,
  createIssueLabel,
  addLabelToIssue,
  removeLabelFromIssue,
  updateIssueState,
  createRalphyAttachment,
  updateAttachmentSubtitle,
  upsertRalphyAttachment,
  setIssueProject,
  createIssue,
  updateIssueDescription,
  buildIssueFilter,
  clauseFromMarkers,
  baseBranchFromLabels,
  formatLinearError,
  isRateLimitedError,
  issueMatchesGetIndicator,
  linearRequestInternals,
} from "../linear-client";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;
const originalSleep = linearRequestInternals.sleep;

function stubResponses(responses: Response[]): {
  count: () => number;
  sleeps: () => number[];
} {
  let i = 0;
  const sleeps: number[] = [];
  const fakeFetch: FetchLike = async () => {
    const r = responses[i++];
    if (!r) throw new Error("unexpected extra fetch call");
    return r;
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  linearRequestInternals.sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { count: () => i, sleeps: () => sleeps };
}

function stubAndCapture(responses: Response[]): {
  count: () => number;
  requests: () => { query: string; variables: Record<string, unknown> }[];
} {
  let i = 0;
  const captured: { query: string; variables: Record<string, unknown> }[] = [];
  (globalThis as { fetch: unknown }).fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    captured.push(body);
    const r = responses[i++];
    if (!r) throw new Error("unexpected extra fetch call");
    return r;
  };
  linearRequestInternals.sleep = async (_ms: number) => {};
  return { count: () => i, requests: () => captured };
}

function makeIssueNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "uuid-1",
    identifier: "ENG-1",
    title: "Test issue",
    description: null,
    url: "https://linear.app/x/ENG-1",
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: { nodes: [] },
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    relations: { nodes: [] },
    ...overrides,
  };
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function err(status: number, body = "", headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  linearRequestInternals.sleep = originalSleep;
});

describe("linear-client transport", () => {
  test("retries 429 honoring Retry-After: 1 then succeeds on the second attempt", async () => {
    const { count, sleeps } = stubResponses([
      err(429, "rate limit", { "Retry-After": "1" }),
      ok({ issues: { nodes: [] } }),
    ]);
    const out = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    });
    expect(out).toEqual([]);
    expect(count()).toBe(2);
    // Retry-After: 1 second → 1000ms, under MAX_RETRY_AFTER_MS (2000)
    expect(sleeps()[0]).toBe(1000);
  });

  test("clamps Retry-After to MAX_RETRY_AFTER_MS (2000ms)", async () => {
    const { sleeps } = stubResponses([
      err(429, "", { "Retry-After": "30" }),
      ok({ issues: { nodes: [] } }),
    ]);
    await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    });
    expect(sleeps()[0]).toBe(2000);
  });

  test("5xx exhaustion surfaces a formatted error with HTTP status + body", async () => {
    stubResponses([err(503, "boom 1"), err(503, "boom 2"), err(503, "final boom")]);
    const e = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    }).catch((x: unknown) => x);
    expect((e as { status?: number }).status).toBe(503);
    const msg = formatLinearError(e);
    expect(msg).toContain("HTTP 503");
    expect(msg).toContain("final boom");
  });

  test("GraphQL errors are surfaced via the messages field", async () => {
    stubResponses([
      new Response(JSON.stringify({ errors: [{ message: "bad input" }, { message: "missing" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ]);
    const e = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    }).catch((x: unknown) => x);
    expect((e as { messages?: string[] }).messages).toEqual(["bad input", "missing"]);
    expect(formatLinearError(e)).toContain("graphql: bad input; missing");
  });

  test("429 exhaustion still marks the error rateLimited", async () => {
    stubResponses([err(429), err(429), err(429)]);
    const e = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    }).catch((x: unknown) => x);
    expect(isRateLimitedError(e)).toBe(true);
  });

  test("linearRequestInternals.sleep is the retry seam", async () => {
    // If the seam were ignored, the default Bun.sleep would actually delay
    // the test; this case completes synchronously because we replaced it.
    const { sleeps } = stubResponses([err(503), ok({ issues: { nodes: [] } })]);
    const start = Date.now();
    await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    });
    expect(Date.now() - start).toBeLessThan(100);
    expect(sleeps().length).toBe(1);
  });
});

describe("issueMatchesGetIndicator with comment markers", () => {
  const baseIssue = {
    labels: [] as string[],
    state: { name: "Todo", type: "unstarted" },
    project: null as { id: string; name: string } | null,
  };

  test("matches when a non-Ralph comment body contains the substring (case-insensitive)", () => {
    expect(
      issueMatchesGetIndicator(
        {
          ...baseIssue,
          comments: [{ body: "Please RALPH GO now", user: { name: "Alice" } }],
        },
        { filter: [{ type: "comment", value: "ralph go" }] },
      ),
    ).toBe(true);
  });

  test("skips Ralph-authored comments (identified by body emoji prefix)", () => {
    expect(
      issueMatchesGetIndicator(
        {
          ...baseIssue,
          comments: [{ body: "🤖 Ralph started a run — ralph go", user: { name: "ralphy" } }],
        },
        { filter: [{ type: "comment", value: "ralph go" }] },
      ),
    ).toBe(false);
  });

  test("returns false when comments slice is missing", () => {
    expect(
      issueMatchesGetIndicator(baseIssue, {
        filter: [{ type: "comment", value: "ralph go" }],
      }),
    ).toBe(false);
  });

  test("returns false when comments is an empty array", () => {
    expect(
      issueMatchesGetIndicator(
        { ...baseIssue, comments: [] },
        { filter: [{ type: "comment", value: "ralph go" }] },
      ),
    ).toBe(false);
  });

  test("any-of semantics: a non-comment marker still wins when present", () => {
    expect(
      issueMatchesGetIndicator(
        { ...baseIssue, labels: ["ralph:auto"] },
        {
          filter: [
            { type: "label", value: "ralph:auto" },
            { type: "comment", value: "never matches" },
          ],
        },
      ),
    ).toBe(true);
  });

  test("status-type indicator matches issue state name (case-insensitive)", () => {
    expect(
      issueMatchesGetIndicator(
        { ...baseIssue, state: { name: "In Progress", type: "started" } },
        { filter: [{ type: "status", value: "in progress" }] },
      ),
    ).toBe(true);
  });

  test("status-type indicator returns false when state name does not match", () => {
    expect(
      issueMatchesGetIndicator(
        { ...baseIssue, state: { name: "Todo", type: "unstarted" } },
        { filter: [{ type: "status", value: "done" }] },
      ),
    ).toBe(false);
  });
});

describe("formatLinearError (capability variant)", () => {
  test("truncates body to 512 chars and appends ellipsis", () => {
    const e = Object.assign(new Error("x"), { status: 500, body: "a".repeat(2000) });
    const msg = formatLinearError(e);
    expect(msg).toContain("…");
    // 512 truncated + the prefix bits, well under 800
    expect(msg.length).toBeLessThan(800);
  });

  test("does not append ellipsis when body fits in 512 chars", () => {
    const e = Object.assign(new Error("x"), { status: 500, body: "short body" });
    const msg = formatLinearError(e);
    expect(msg).toContain("short body");
    expect(msg).not.toContain("…");
  });
});

// ---------------------------------------------------------------------------
// fetchOpenIssues
// ---------------------------------------------------------------------------

describe("fetchOpenIssues", () => {
  test("returns mapped issues on success", async () => {
    stubResponses([ok({ issues: { nodes: [makeIssueNode()] } })]);
    const issues = await fetchOpenIssues("k", {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.identifier).toBe("ENG-1");
    expect(issues[0]!.labels).toEqual([]);
    expect(issues[0]!.blockedByIds).toEqual([]);
  });

  test("returns empty array when no issues", async () => {
    stubResponses([ok({ issues: { nodes: [] } })]);
    const issues = await fetchOpenIssues("k", {});
    expect(issues).toEqual([]);
  });

  test("populates project.priority and milestone when present", async () => {
    const node = makeIssueNode({
      project: { id: "proj-1", name: "Platform", priority: 2 },
      projectMilestone: {
        id: "ms-1",
        name: "Beta",
        sortOrder: 1.5,
        targetDate: "2026-03-01",
      },
    });
    stubResponses([ok({ issues: { nodes: [node] } })]);
    const issues = await fetchOpenIssues("k", {});
    expect(issues[0]!.project).toEqual({ id: "proj-1", name: "Platform", priority: 2 });
    expect(issues[0]!.milestone).toEqual({
      id: "ms-1",
      name: "Beta",
      sortOrder: 1.5,
      targetDate: "2026-03-01",
    });
  });

  test("leaves project.priority and milestone undefined when absent", async () => {
    const node = makeIssueNode({
      project: { id: "proj-1", name: "Platform" },
      projectMilestone: null,
    });
    stubResponses([ok({ issues: { nodes: [node] } })]);
    const issues = await fetchOpenIssues("k", {});
    expect(issues[0]!.project).toEqual({ id: "proj-1", name: "Platform" });
    expect(issues[0]!.project!.priority).toBeUndefined();
    expect(issues[0]!.milestone).toBeUndefined();
    // existing blockedByIds mapping unchanged
    expect(issues[0]!.blockedByIds).toEqual([]);
  });

  test("omits milestone.targetDate when null", async () => {
    const node = makeIssueNode({
      projectMilestone: { id: "ms-1", name: "Beta", sortOrder: 0, targetDate: null },
    });
    stubResponses([ok({ issues: { nodes: [node] } })]);
    const issues = await fetchOpenIssues("k", {});
    expect(issues[0]!.milestone).toEqual({ id: "ms-1", name: "Beta", sortOrder: 0 });
    expect(issues[0]!.milestone!.targetDate).toBeUndefined();
  });

  test("includes comments slice when includeComments is true", async () => {
    const node = makeIssueNode({
      comments: {
        nodes: [
          {
            id: "c1",
            body: "hello",
            createdAt: "2026-01-01T00:00:00Z",
            user: { name: "Alice", email: null },
          },
        ],
      },
    });
    const { requests } = stubAndCapture([ok({ issues: { nodes: [node] } })]);
    const issues = await fetchOpenIssues("k", {}, { includeComments: true });
    expect(issues[0]!.comments).toHaveLength(1);
    expect(requests()[0]!.query).toContain("comments");
  });
});

// ---------------------------------------------------------------------------
// fetchIssueComments
// ---------------------------------------------------------------------------

describe("fetchIssueComments", () => {
  test("returns comment nodes on success", async () => {
    const comments = [
      {
        id: "c1",
        body: "first",
        createdAt: "2026-01-01T00:00:00Z",
        user: { name: "Bob", email: null },
      },
    ];
    stubResponses([ok({ issue: { comments: { nodes: comments } } })]);
    const result = await fetchIssueComments("k", "issue-1");
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe("first");
  });

  test("returns empty array when issue has no comments", async () => {
    stubResponses([ok({ issue: { comments: { nodes: [] } } })]);
    const result = await fetchIssueComments("k", "issue-1");
    expect(result).toEqual([]);
  });

  test("returns empty array when issue is null", async () => {
    stubResponses([ok({ issue: null })]);
    const result = await fetchIssueComments("k", "issue-1");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchWorkflowStates
// ---------------------------------------------------------------------------

describe("fetchWorkflowStates", () => {
  test("returns mapped workflow states", async () => {
    const nodes = [
      { id: "s1", name: "Todo", type: "unstarted" },
      { id: "s2", name: "In Progress", type: "started" },
      { id: "s3", name: "Done", type: "completed" },
    ];
    stubResponses([ok({ workflowStates: { nodes } })]);
    const states = await fetchWorkflowStates("k", "ENG");
    expect(states).toHaveLength(3);
    expect(states[0]!.name).toBe("Todo");
    expect(states[2]!.type).toBe("completed");
  });

  test("passes team key in the query variable", async () => {
    const { requests } = stubAndCapture([ok({ workflowStates: { nodes: [] } })]);
    await fetchWorkflowStates("k", "MYTEAM");
    expect(requests()[0]!.variables).toMatchObject({ team: "MYTEAM" });
  });
});

// ---------------------------------------------------------------------------
// fetchTeamIdByKey
// ---------------------------------------------------------------------------

describe("fetchTeamIdByKey", () => {
  test("returns team id when found", async () => {
    stubResponses([ok({ teams: { nodes: [{ id: "team-abc" }] } })]);
    const id = await fetchTeamIdByKey("k", "ENG");
    expect(id).toBe("team-abc");
  });

  test("returns null when team not found", async () => {
    stubResponses([ok({ teams: { nodes: [] } })]);
    const id = await fetchTeamIdByKey("k", "UNKNOWN");
    expect(id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchIssueLabels
// ---------------------------------------------------------------------------

describe("fetchIssueLabels", () => {
  test("merges workspace and team labels (team overrides workspace on name collision)", async () => {
    // fetchIssueLabels calls both teamQuery and workspaceQuery in Promise.all
    // stubResponses pops responses in call order; with Promise.all the order
    // follows the construction order (team first, workspace second).
    const teamNodes = [{ id: "t1", name: "bug", parent: null }];
    const wsNodes = [{ id: "w1", name: "feature", parent: null }];
    stubResponses([
      ok({ issueLabels: { nodes: teamNodes } }),
      ok({ issueLabels: { nodes: wsNodes } }),
    ]);
    const labels = await fetchIssueLabels("k", "ENG");
    expect(labels.some((l) => l.name === "bug")).toBe(true);
    expect(labels.some((l) => l.name === "feature")).toBe(true);
  });

  test("prefixes child labels with parent name", async () => {
    const teamNodes = [{ id: "l1", name: "fix", parent: { name: "ralph" } }];
    stubResponses([ok({ issueLabels: { nodes: teamNodes } }), ok({ issueLabels: { nodes: [] } })]);
    const labels = await fetchIssueLabels("k", "ENG");
    expect(labels[0]!.name).toBe("ralph:fix");
  });
});

// ---------------------------------------------------------------------------
// fetchIssueAttachments + findIssueAttachmentByTitle
// ---------------------------------------------------------------------------

describe("fetchIssueAttachments", () => {
  test("returns attachment nodes", async () => {
    const nodes = [{ id: "a1", url: "https://x.com", sourceType: null, title: "Ralphy" }];
    stubResponses([ok({ issue: { attachments: { nodes } } })]);
    const result = await fetchIssueAttachments("k", "issue-1");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a1");
  });

  test("returns empty array when issue has no attachments", async () => {
    stubResponses([ok({ issue: { attachments: { nodes: [] } } })]);
    const result = await fetchIssueAttachments("k", "issue-1");
    expect(result).toEqual([]);
  });
});

describe("findIssueAttachmentByTitle", () => {
  test("returns attachment id when title matches", async () => {
    const nodes = [{ id: "a2", title: "Ralphy" }];
    stubResponses([ok({ issue: { attachments: { nodes } } })]);
    const id = await findIssueAttachmentByTitle("k", "issue-1", "Ralphy");
    expect(id).toBe("a2");
  });

  test("returns null when title does not match", async () => {
    stubResponses([ok({ issue: { attachments: { nodes: [{ id: "a3", title: "Other" }] } } })]);
    const id = await findIssueAttachmentByTitle("k", "issue-1", "Ralphy");
    expect(id).toBeNull();
  });

  test("returns null when no attachments", async () => {
    stubResponses([ok({ issue: { attachments: { nodes: [] } } })]);
    const id = await findIssueAttachmentByTitle("k", "issue-1", "Ralphy");
    expect(id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchProjectIdByName
// ---------------------------------------------------------------------------

describe("fetchProjectIdByName", () => {
  test("returns project id when found", async () => {
    stubResponses([ok({ projects: { nodes: [{ id: "proj-1" }] } })]);
    const id = await fetchProjectIdByName("k", "My Project");
    expect(id).toBe("proj-1");
  });

  test("returns null when project not found", async () => {
    stubResponses([ok({ projects: { nodes: [] } })]);
    const id = await fetchProjectIdByName("k", "Ghost Project");
    expect(id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findOpenIssueByLabel
// ---------------------------------------------------------------------------

describe("findOpenIssueByLabel", () => {
  test("returns the first matching issue", async () => {
    const node = { id: "i1", identifier: "ENG-10", description: "do things" };
    stubResponses([ok({ issues: { nodes: [node] } })]);
    const result = await findOpenIssueByLabel("k", "ENG", "my-label");
    expect(result).not.toBeNull();
    expect(result!.identifier).toBe("ENG-10");
  });

  test("returns null when no issue matches", async () => {
    stubResponses([ok({ issues: { nodes: [] } })]);
    const result = await findOpenIssueByLabel("k", "ENG", "nonexistent-label");
    expect(result).toBeNull();
  });

  test("sends label name in query variables", async () => {
    const { requests } = stubAndCapture([ok({ issues: { nodes: [] } })]);
    await findOpenIssueByLabel("k", "ENG", "my-label");
    expect(requests()[0]!.variables).toMatchObject({ label: "my-label", team: "ENG" });
  });
});

// ---------------------------------------------------------------------------
// addIssueComment + updateIssueComment
// ---------------------------------------------------------------------------

describe("addIssueComment", () => {
  test("resolves on success without returning a value", async () => {
    stubResponses([ok({ commentCreate: { success: true } })]);
    await expect(addIssueComment("k", "issue-1", "hello")).resolves.toBeUndefined();
  });

  test("sends issueId and body in variables", async () => {
    const { requests } = stubAndCapture([ok({ commentCreate: { success: true } })]);
    await addIssueComment("k", "issue-xyz", "my comment");
    expect(requests()[0]!.variables).toMatchObject({ issueId: "issue-xyz", body: "my comment" });
  });
});

describe("updateIssueComment", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ commentUpdate: { success: true } })]);
    await expect(updateIssueComment("k", "comment-1", "updated body")).resolves.toBeUndefined();
  });

  test("sends comment id and new body", async () => {
    const { requests } = stubAndCapture([ok({ commentUpdate: { success: true } })]);
    await updateIssueComment("k", "c-99", "new text");
    expect(requests()[0]!.variables).toMatchObject({ id: "c-99", body: "new text" });
  });
});

// ---------------------------------------------------------------------------
// deleteIssueComment
// ---------------------------------------------------------------------------

describe("deleteIssueComment", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ commentDelete: { success: true } })]);
    await expect(deleteIssueComment("k", "comment-1")).resolves.toBeUndefined();
  });

  test("sends comment id in variables", async () => {
    const { requests } = stubAndCapture([ok({ commentDelete: { success: true } })]);
    await deleteIssueComment("k", "c-42");
    expect(requests()[0]!.variables).toMatchObject({ id: "c-42" });
  });
});

// ---------------------------------------------------------------------------
// createIssueLabel
// ---------------------------------------------------------------------------

describe("createIssueLabel", () => {
  test("returns new label id on success", async () => {
    stubResponses([ok({ issueLabelCreate: { success: true, issueLabel: { id: "lbl-1" } } })]);
    const id = await createIssueLabel("k", "team-1", "my-label");
    expect(id).toBe("lbl-1");
  });

  test("returns null when issueLabel payload is missing", async () => {
    stubResponses([ok({ issueLabelCreate: { success: false, issueLabel: null } })]);
    const id = await createIssueLabel("k", "team-1", "bad-label");
    expect(id).toBeNull();
  });

  test("includes parentId in variables when provided", async () => {
    const { requests } = stubAndCapture([
      ok({ issueLabelCreate: { success: true, issueLabel: { id: "lbl-2" } } }),
    ]);
    await createIssueLabel("k", "team-1", "child", "parent-id");
    expect(requests()[0]!.variables).toMatchObject({ parentId: "parent-id" });
  });
});

// ---------------------------------------------------------------------------
// addLabelToIssue + removeLabelFromIssue
// ---------------------------------------------------------------------------

describe("addLabelToIssue", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ issueAddLabel: { success: true } })]);
    await expect(addLabelToIssue("k", "issue-1", "label-1")).resolves.toBeUndefined();
  });

  test("sends issueId and labelId in variables", async () => {
    const { requests } = stubAndCapture([ok({ issueAddLabel: { success: true } })]);
    await addLabelToIssue("k", "i-1", "l-1");
    expect(requests()[0]!.variables).toMatchObject({ id: "i-1", labelId: "l-1" });
  });
});

describe("removeLabelFromIssue", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ issueRemoveLabel: { success: true } })]);
    await expect(removeLabelFromIssue("k", "issue-1", "label-1")).resolves.toBeUndefined();
  });

  test("sends issueId and labelId in variables", async () => {
    const { requests } = stubAndCapture([ok({ issueRemoveLabel: { success: true } })]);
    await removeLabelFromIssue("k", "i-2", "l-2");
    expect(requests()[0]!.variables).toMatchObject({ id: "i-2", labelId: "l-2" });
  });
});

// ---------------------------------------------------------------------------
// updateIssueState
// ---------------------------------------------------------------------------

describe("updateIssueState", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ issueUpdate: { success: true } })]);
    await expect(updateIssueState("k", "issue-1", "state-1")).resolves.toBeUndefined();
  });

  test("sends issueId and stateId in variables", async () => {
    const { requests } = stubAndCapture([ok({ issueUpdate: { success: true } })]);
    await updateIssueState("k", "i-3", "s-3");
    expect(requests()[0]!.variables).toMatchObject({ id: "i-3", stateId: "s-3" });
  });
});

// ---------------------------------------------------------------------------
// createRalphyAttachment + updateAttachmentSubtitle
// ---------------------------------------------------------------------------

describe("createRalphyAttachment", () => {
  test("returns new attachment id on success", async () => {
    stubResponses([ok({ attachmentCreate: { success: true, attachment: { id: "att-1" } } })]);
    const id = await createRalphyAttachment("k", "issue-1", "https://x.com", "running");
    expect(id).toBe("att-1");
  });

  test("sends title=Ralphy and subtitle in variables", async () => {
    const { requests } = stubAndCapture([
      ok({ attachmentCreate: { success: true, attachment: { id: "att-2" } } }),
    ]);
    await createRalphyAttachment("k", "i-1", "https://x.com", "my-subtitle");
    expect(requests()[0]!.variables).toMatchObject({
      title: "Ralphy",
      subtitle: "my-subtitle",
    });
  });

  test("throws when attachment id is missing", async () => {
    stubResponses([ok({ attachmentCreate: { success: false, attachment: null } })]);
    await expect(createRalphyAttachment("k", "i-1", "https://x.com", "s")).rejects.toThrow(
      "attachmentCreate returned no attachment id",
    );
  });
});

describe("updateAttachmentSubtitle", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ attachmentUpdate: { success: true } })]);
    await expect(updateAttachmentSubtitle("k", "att-1", "new subtitle")).resolves.toBeUndefined();
  });

  test("sends attachment id and new subtitle", async () => {
    const { requests } = stubAndCapture([ok({ attachmentUpdate: { success: true } })]);
    await updateAttachmentSubtitle("k", "att-99", "updated");
    expect(requests()[0]!.variables).toMatchObject({ id: "att-99", subtitle: "updated" });
  });
});

// ---------------------------------------------------------------------------
// upsertRalphyAttachment
// ---------------------------------------------------------------------------

describe("upsertRalphyAttachment", () => {
  test("updates subtitle when attachment already exists", async () => {
    // fetchIssueAttachments → returns existing attachment
    // updateAttachmentSubtitle → returns success
    const { requests } = stubAndCapture([
      ok({
        issue: {
          attachments: {
            nodes: [{ id: "att-existing", url: "u", sourceType: null, title: "Ralphy" }],
          },
        },
      }),
      ok({ attachmentUpdate: { success: true } }),
    ]);
    await upsertRalphyAttachment("k", "issue-1", "https://x.com", "new-subtitle");
    // second call should be the updateAttachmentSubtitle mutation
    expect(requests()[1]!.variables).toMatchObject({
      id: "att-existing",
      subtitle: "new-subtitle",
    });
  });

  test("creates attachment when none exists", async () => {
    const { requests } = stubAndCapture([
      ok({ issue: { attachments: { nodes: [] } } }),
      ok({ attachmentCreate: { success: true, attachment: { id: "att-new" } } }),
    ]);
    await upsertRalphyAttachment("k", "issue-1", "https://x.com", "created-subtitle");
    expect(requests()[1]!.variables).toMatchObject({
      title: "Ralphy",
      subtitle: "created-subtitle",
    });
  });
});

// ---------------------------------------------------------------------------
// setIssueProject + createIssue + updateIssueDescription
// ---------------------------------------------------------------------------

describe("setIssueProject", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ issueUpdate: { success: true } })]);
    await expect(setIssueProject("k", "issue-1", "proj-1")).resolves.toBeUndefined();
  });

  test("sends issueId and projectId in variables", async () => {
    const { requests } = stubAndCapture([ok({ issueUpdate: { success: true } })]);
    await setIssueProject("k", "i-5", "p-5");
    expect(requests()[0]!.variables).toMatchObject({ id: "i-5", projectId: "p-5" });
  });
});

describe("createIssue", () => {
  test("returns id and identifier on success", async () => {
    stubResponses([
      ok({ issueCreate: { success: true, issue: { id: "i-new", identifier: "ENG-99" } } }),
    ]);
    const result = await createIssue("k", {
      teamId: "team-1",
      title: "New Issue",
      description: "desc",
    });
    expect(result).toMatchObject({ id: "i-new", identifier: "ENG-99" });
  });

  test("throws when issue is missing from response", async () => {
    stubResponses([ok({ issueCreate: { success: false, issue: null } })]);
    await expect(
      createIssue("k", { teamId: "team-1", title: "x", description: "y" }),
    ).rejects.toThrow("issueCreate returned no issue");
  });

  test("includes labelIds in input when provided", async () => {
    const { requests } = stubAndCapture([
      ok({ issueCreate: { success: true, issue: { id: "i-2", identifier: "ENG-2" } } }),
    ]);
    await createIssue("k", {
      teamId: "t-1",
      title: "t",
      description: "d",
      labelIds: ["l-1", "l-2"],
    });
    expect((requests()[0]!.variables as { input: { labelIds?: string[] } }).input.labelIds).toEqual(
      ["l-1", "l-2"],
    );
  });
});

describe("updateIssueDescription", () => {
  test("resolves on success", async () => {
    stubResponses([ok({ issueUpdate: { success: true } })]);
    await expect(updateIssueDescription("k", "issue-1", "new desc")).resolves.toBeUndefined();
  });

  test("sends issueId and description in variables", async () => {
    const { requests } = stubAndCapture([ok({ issueUpdate: { success: true } })]);
    await updateIssueDescription("k", "i-6", "updated desc");
    expect(requests()[0]!.variables).toMatchObject({ id: "i-6", description: "updated desc" });
  });
});

// ---------------------------------------------------------------------------
// buildIssueFilter (pure, no fetch needed)
// ---------------------------------------------------------------------------

describe("buildIssueFilter", () => {
  test("default spec produces open-state-type filter", () => {
    const f = buildIssueFilter({});
    expect(f).toMatchObject({ state: { type: { in: ["unstarted", "started", "backlog"] } } });
  });

  test("team spec adds team key filter", () => {
    const f = buildIssueFilter({ team: "ENG" });
    expect(f).toMatchObject({ team: { key: { eq: "ENG" } } });
  });

  test("assignee=me uses isMe filter", () => {
    const f = buildIssueFilter({ assignee: "me" });
    expect(f).toMatchObject({ assignee: { isMe: { eq: true } } });
  });

  test("assignee email uses email filter", () => {
    const f = buildIssueFilter({ assignee: "dev@example.com" });
    expect(f).toMatchObject({ assignee: { email: { eq: "dev@example.com" } } });
  });

  test("include label marker adds labels filter", () => {
    const f = buildIssueFilter({ include: [{ type: "label", value: "bug" }] });
    expect(f).toMatchObject({ labels: { some: { name: { in: ["bug"] } } } });
  });

  test("include status marker adds state.name filter", () => {
    const f = buildIssueFilter({ include: [{ type: "status", value: "In Progress" }] });
    expect(f).toMatchObject({ state: { name: { in: ["In Progress"] } } });
  });

  test("exclude status marker places state.name nin in an and-clause (default state already present)", () => {
    const f = buildIssueFilter({ exclude: [{ type: "status", value: "Done" }] });
    // Default include adds where.state; exclude then merges into an `and` array
    const andClauses = f.and as Record<string, unknown>[] | undefined;
    expect(andClauses).toBeDefined();
    expect(andClauses!).toContainEqual({ state: { name: { nin: ["Done"] } } });
  });

  test("exclude label marker adds labels.every filter", () => {
    const f = buildIssueFilter({ exclude: [{ type: "label", value: "skip-me" }] });
    expect(f).toMatchObject({ labels: { every: { name: { nin: ["skip-me"] } } } });
  });
});

// ---------------------------------------------------------------------------
// clauseFromMarkers (pure, no fetch needed)
// ---------------------------------------------------------------------------

describe("clauseFromMarkers", () => {
  test("returns null for empty markers array", () => {
    expect(clauseFromMarkers([])).toBeNull();
  });

  test("builds state clause for status marker", () => {
    const result = clauseFromMarkers([{ type: "status", value: "Done" }]);
    expect(result).toMatchObject({ state: { name: { in: ["Done"] } } });
  });

  test("builds labels clause for label marker", () => {
    const result = clauseFromMarkers([{ type: "label", value: "bug" }]);
    expect(result).toMatchObject({ labels: { some: { name: { in: ["bug"] } } } });
  });

  test("builds attachment clause for attachment marker", () => {
    const result = clauseFromMarkers([{ type: "attachment", value: "running" }]);
    expect(result).toMatchObject({
      attachments: { some: { title: { eq: "Ralphy" }, subtitle: { in: ["running"] } } },
    });
  });

  test("builds project clause for project marker", () => {
    const result = clauseFromMarkers([{ type: "project", value: "My Project" }]);
    expect(result).toMatchObject({ project: { name: { in: ["My Project"] } } });
  });

  test("returns null for comment-only markers (no GraphQL clause)", () => {
    const result = clauseFromMarkers([{ type: "comment", value: "go" }]);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// baseBranchFromLabels (pure, no fetch needed)
// ---------------------------------------------------------------------------

describe("baseBranchFromLabels", () => {
  test("extracts branch name from ralph:branch: label", () => {
    expect(baseBranchFromLabels(["ralph:branch:main"])).toBe("main");
  });

  test("handles forward slashes in branch name", () => {
    expect(baseBranchFromLabels(["ralph:branch:feature/my-feat"])).toBe("feature/my-feat");
  });

  test("returns undefined when no matching label", () => {
    expect(baseBranchFromLabels(["unrelated", "other:label"])).toBeUndefined();
  });

  test("returns undefined for empty labels array", () => {
    expect(baseBranchFromLabels([])).toBeUndefined();
  });

  test("is case-insensitive on the prefix", () => {
    expect(baseBranchFromLabels(["RALPH:BRANCH:develop"])).toBe("develop");
  });

  test("returns undefined when branch value is empty", () => {
    expect(baseBranchFromLabels(["ralph:branch:"])).toBeUndefined();
  });

  test("returns undefined when branch value is only whitespace", () => {
    expect(baseBranchFromLabels(["ralph:branch:   "])).toBeUndefined();
  });
});
