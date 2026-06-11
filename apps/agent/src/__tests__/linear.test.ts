import { afterEach, describe, expect, test } from "bun:test";
import {
  baseBranchFromLabels,
  createAttachmentForUrl,
  createIssue,
  fetchMentionScanIssues,
  findOpenIssueByLabel,
  formatLinearError,
  isRateLimitedError,
  issueMatchesGetIndicator,
  linearRequestInternals,
  deleteAttachment,
  updateIssueDescription,
  uploadFileToLinear,
} from "../shared/capabilities/linear-client";

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
    project: null,
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
      if (!r) {
        const err = new Error("unexpected extra fetch call");
        (err as Error & { callIndex?: number }).callIndex = i;
        throw err;
      }
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

  test("retries 503 then succeeds", async () => {
    const { count } = stubResponses([errResponse(503), okResponse({ issues: { nodes: [] } })]);
    await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    });
    expect(count()).toBe(2);
  });

  test("does NOT retry 404", async () => {
    const { count } = stubResponses([errResponse(404, "not found")]);
    await expect(
      fetchMentionScanIssues("k", { indicators: { setDone: { type: "status", value: "Done" } } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(count()).toBe(1);
  });
});

describe("rate-limit detection (RLF-65)", () => {
  const originalSleep = linearRequestInternals.sleep;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    linearRequestInternals.sleep = originalSleep;
  });

  function stubRepeat(response: Response): { count: () => number } {
    let i = 0;
    const fakeFetch: FetchLike = async () => {
      i++;
      return response.clone();
    };
    globalThis.fetch = fakeFetch as typeof fetch;
    linearRequestInternals.sleep = async () => {};
    return { count: () => i };
  }

  function stubOnce(response: Response): { count: () => number } {
    let i = 0;
    const fakeFetch: FetchLike = async () => {
      i++;
      return response;
    };
    globalThis.fetch = fakeFetch as typeof fetch;
    linearRequestInternals.sleep = async () => {};
    return { count: () => i };
  }

  test("a 429 retries with rateLimited flag and exhausts after the retry budget", async () => {
    const { count } = stubRepeat(new Response("", { status: 429 }));
    const err = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    }).catch((e: unknown) => e);
    expect(isRateLimitedError(err)).toBe(true);
    expect((err as { status?: number }).status).toBe(429);
    expect(count()).toBeGreaterThan(1);
  });

  test("a 400 with 'Rate limit exceeded' body retries and marks rateLimited", async () => {
    const { count } = stubRepeat(
      new Response('{"errors":[{"message":"Rate limit exceeded for query"}]}', { status: 400 }),
    );
    const err = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    }).catch((e: unknown) => e);
    expect(isRateLimitedError(err)).toBe(true);
    expect((err as { status?: number }).status).toBe(400);
    expect(count()).toBeGreaterThan(1);
  });

  test("a plain 400 is NOT marked rateLimited", async () => {
    const { count } = stubOnce(new Response("nope", { status: 400 }));
    const err = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    }).catch((e: unknown) => e);
    expect(isRateLimitedError(err)).toBe(false);
    expect((err as { status?: number }).status).toBe(400);
    expect(count()).toBe(1);
  });

  test("formatLinearError prepends 'rate limited' for rate-limited errors", () => {
    const err = Object.assign(new Error("Linear API request failed"), {
      status: 429,
      body: "a".repeat(500),
      rateLimited: true,
    });
    const msg = formatLinearError(err);
    expect(msg).toContain("rate limited");
    expect(msg).not.toContain("aaaa");
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

  test("truncates body to 512 chars", () => {
    const err = Object.assign(new Error("x"), {
      status: 500,
      body: "a".repeat(2000),
    });
    const msg = formatLinearError(err);
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(800);
  });

  test("joins graphql messages with '; '", () => {
    const err = Object.assign(new Error("x"), {
      messages: ["one", "two", "three"],
    });
    const msg = formatLinearError(err);
    expect(msg).toContain("one; two; three");
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

  test("filter ORs together getTodo, getInProgress, and setDone indicator clauses", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchMentionScanIssues("k", {
      team: "RLF",
      assignee: "me",
      indicators: {
        getTodo: { filter: [{ type: "status", value: "Todo" }] },
        getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
        setDone: { type: "status", value: "In Review" },
      },
    });
    const filter = calls[0]!.variables.filter as {
      or: { state: { name: { in: string[] } } }[];
      team: { key: { eq: string } };
      assignee: { isMe: { eq: boolean } };
    };
    expect(filter.or).toHaveLength(3);
    expect(filter.or.map((b) => b.state.name.in)).toEqual([
      ["Todo"],
      ["In Progress"],
      ["In Review"],
    ]);
    expect(filter.team).toEqual({ key: { eq: "RLF" } });
    expect(filter.assignee).toEqual({ isMe: { eq: true } });
  });

  test("returns [] without a network call when no indicators are configured", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    const out = await fetchMentionScanIssues("k", { team: "RLF", indicators: {} });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("single-indicator config inlines the clause (no `or:` wrapper)", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "label", value: "ralph:done" } },
    });
    const filter = calls[0]!.variables.filter as {
      or?: unknown;
      labels: { some: { name: { in: string[] } } };
    };
    expect(filter.or).toBeUndefined();
    expect(filter.labels.some.name.in).toEqual(["ralph:done"]);
  });

  test("assignee email and id forms are routed correctly", async () => {
    const seen: Record<string, unknown>[] = [];
    const { calls } = stubFetch((body) => {
      seen.push(body.variables.filter as Record<string, unknown>);
      return { issues: { nodes: [] } };
    });
    const indicators = { setDone: { type: "status" as const, value: "Done" } };
    await fetchMentionScanIssues("k", { assignee: "user@example.com", indicators });
    await fetchMentionScanIssues("k", { assignee: "user-id-xyz", indicators });
    expect(calls).toHaveLength(2);
    expect(seen[0]!.assignee).toEqual({ email: { eq: "user@example.com" } });
    expect(seen[1]!.assignee).toEqual({ id: { eq: "user-id-xyz" } });
  });

  test("maps nodes into TrackedIssue shape and filters Done blockers", async () => {
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
            inverseRelations: {
              nodes: [
                {
                  type: "blocks",
                  issue: {
                    id: "blocker-open",
                    identifier: "RLF-BLOCK",
                    state: { type: "started" },
                  },
                },
                {
                  type: "blocks",
                  issue: {
                    id: "blocker-done",
                    identifier: "RLF-DONE",
                    state: { type: "completed" },
                  },
                },
                {
                  type: "duplicate",
                  issue: {
                    id: "ignored",
                    identifier: "RLF-IGN",
                    state: { type: "started" },
                  },
                },
              ],
            },
          },
        ],
      },
    }));
    const issues = await fetchMentionScanIssues("k", {
      indicators: { setDone: { type: "status", value: "Done" } },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: "i1",
      identifier: "RLF-1",
      labels: ["x", "y"],
      blockedByIds: ["blocker-open"],
      blockedByIdentifiers: ["RLF-BLOCK"],
    });
  });
});

describe("spec attachment mutations (RLF-74)", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("uploadFileToLinear performs fileUpload mutation then signed PUT and returns assetUrl", async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      const method = init?.method ?? "POST";
      const headers: Record<string, string> = {};
      const initHeaders = (init?.headers ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(initHeaders)) headers[k] = v;
      calls.push({ url, method, headers });
      if (url.includes("linear.app")) {
        return new Response(
          JSON.stringify({
            data: {
              fileUpload: {
                uploadFile: {
                  uploadUrl: "https://put.example/abc",
                  assetUrl: "https://uploads.linear.app/abc",
                  headers: [{ key: "x-amz-acl", value: "private" }],
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("", { status: 200 });
    };
    globalThis.fetch = fakeFetch as typeof fetch;
    const out = await uploadFileToLinear("k", {
      filename: "proposal.md",
      contentType: "text/markdown",
      bytes: new TextEncoder().encode("hello"),
    });
    expect(out.assetUrl).toBe("https://uploads.linear.app/abc");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.method).toBe("PUT");
    expect(calls[1]!.url).toBe("https://put.example/abc");
    expect(calls[1]!.headers["x-amz-acl"]).toBe("private");
  });

  test("uploadFileToLinear throws when fileUpload returns null payload", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(JSON.stringify({ data: { fileUpload: { uploadFile: null } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    globalThis.fetch = fakeFetch as typeof fetch;
    await expect(
      uploadFileToLinear("k", {
        filename: "f.md",
        contentType: "text/markdown",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/no uploadFile payload/);
  });

  test("uploadFileToLinear throws when GraphQL omits fileUpload entirely (regression: nesting bug)", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({ data: { uploadFile: { uploadUrl: "x", assetUrl: "y", headers: [] } } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    globalThis.fetch = fakeFetch as typeof fetch;
    await expect(
      uploadFileToLinear("k", {
        filename: "f.md",
        contentType: "text/markdown",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/no uploadFile payload/);
  });

  test("uploadFileToLinear throws with status+body when PUT fails", async () => {
    let i = 0;
    const fakeFetch: FetchLike = async () => {
      i++;
      if (i === 1) {
        return new Response(
          JSON.stringify({
            data: {
              fileUpload: {
                uploadFile: {
                  uploadUrl: "https://put.example/x",
                  assetUrl: "https://uploads.linear.app/x",
                  headers: [],
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("denied", { status: 403 });
    };
    globalThis.fetch = fakeFetch as typeof fetch;
    let caught: (Error & { status?: number; body?: string }) | null = null;
    try {
      await uploadFileToLinear("k", {
        filename: "f.md",
        contentType: "text/markdown",
        bytes: new Uint8Array([1]),
      });
    } catch (err) {
      caught = err as Error & { status?: number; body?: string };
    }
    expect(caught).not.toBeNull();
    expect(caught!.status).toBe(403);
    expect(caught!.body).toBe("denied");
  });

  test("createAttachmentForUrl posts attachmentCreate and returns id", async () => {
    const { calls } = stubFetch(() => ({
      attachmentCreate: { success: true, attachment: { id: "att-42" } },
    }));
    const id = await createAttachmentForUrl("k", {
      issueId: "iss-1",
      url: "https://uploads.linear.app/x",
      title: "Ralph proposal",
      subtitle: "iteration 3",
    });
    expect(id).toBe("att-42");
    expect(calls[0]!.variables).toMatchObject({
      issueId: "iss-1",
      url: "https://uploads.linear.app/x",
      title: "Ralph proposal",
      subtitle: "iteration 3",
    });
  });

  test("createAttachmentForUrl throws when attachment is null", async () => {
    stubFetch(() => ({ attachmentCreate: { success: false, attachment: null } }));
    await expect(
      createAttachmentForUrl("k", { issueId: "i", url: "u", title: "t" }),
    ).rejects.toThrow(/no attachment id/);
  });

  test("deleteAttachment posts the attachmentDelete mutation with the id", async () => {
    const { calls } = stubFetch(() => ({ attachmentDelete: { success: true } }));
    await deleteAttachment("k", "att-1");
    expect(calls[0]!.variables).toEqual({ id: "att-1" });
    expect(calls[0]!.query).toContain("attachmentDelete");
  });
});
