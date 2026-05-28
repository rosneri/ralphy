import { afterEach, describe, expect, test } from "bun:test";
import {
  fetchMentionScanIssues,
  isRateLimitedError,
  linearRequestInternals,
} from "../shared/capabilities/linear-client";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;
const originalSleep = linearRequestInternals.sleep;

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rateLimitResponse(): Response {
  return new Response("rate limit exceeded", {
    status: 429,
    headers: {},
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  linearRequestInternals.sleep = originalSleep;
});

function stubFetch(responses: Response[]): void {
  let i = 0;
  const fakeFetch: FetchLike = async () => {
    const r = responses[i++];
    if (!r) throw new Error("unexpected extra fetch call");
    return r;
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  linearRequestInternals.sleep = async () => {};
}

function makeIssueNodeWithComment(comment: {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string; email: string | null };
}): Record<string, unknown> {
  return {
    id: "issue-uuid-1",
    identifier: "ENG-1",
    title: "Test issue",
    description: null,
    url: "https://linear.app/x/ENG-1",
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels: { nodes: [{ name: "ralph:auto" }] },
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    relations: { nodes: [] },
    comments: { nodes: [comment] },
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: trigger-found — issue with a matching comment is returned
// ---------------------------------------------------------------------------

describe("mention-scan integration: trigger-found", () => {
  test("returns an issue when a comment matches the getTodo indicator label", async () => {
    const issueNode = makeIssueNodeWithComment({
      id: "c-1",
      body: "Please @ralphy start this",
      createdAt: "2026-05-01T10:00:00.000Z",
      user: { name: "Alice", email: "alice@example.com" },
    });
    stubFetch([ok({ issues: { nodes: [issueNode] } })]);

    const results = await fetchMentionScanIssues("api-key", {
      indicators: {
        getTodo: { filter: [{ type: "label", value: "ralph:auto" }] },
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.identifier).toBe("ENG-1");
    expect(results[0]!.labels).toContain("ralph:auto");
    expect(results[0]!.comments).toHaveLength(1);
    expect(results[0]!.comments![0]!.body).toContain("@ralphy");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: no-issues — API returns empty nodes array
// ---------------------------------------------------------------------------

describe("mention-scan integration: no-issues", () => {
  test("returns an empty array when the API returns no matching issues", async () => {
    stubFetch([ok({ issues: { nodes: [] } })]);

    const results = await fetchMentionScanIssues("api-key", {
      indicators: {
        getTodo: { filter: [{ type: "label", value: "ralph:auto" }] },
      },
    });

    expect(results).toEqual([]);
  });

  test("returns empty array immediately when no indicator branches can be built", async () => {
    // When all indicator fields are undefined, no branches → short-circuit, no fetch
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return ok({ issues: { nodes: [] } });
    }) as typeof fetch;

    const results = await fetchMentionScanIssues("api-key", {
      indicators: {},
    });

    expect(results).toEqual([]);
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: rate-limit-propagation — 429 exhaustion marks error rateLimited
// ---------------------------------------------------------------------------

describe("mention-scan integration: rate-limit-propagation", () => {
  test("throws an error with rateLimited=true after 429 exhaustion", async () => {
    // Three 429s exhaust MAX_LINEAR_ATTEMPTS (3)
    stubFetch([rateLimitResponse(), rateLimitResponse(), rateLimitResponse()]);

    const err = await fetchMentionScanIssues("api-key", {
      indicators: {
        getTodo: { filter: [{ type: "label", value: "ralph:auto" }] },
      },
    }).catch((e: unknown) => e);

    expect(isRateLimitedError(err)).toBe(true);
  });

  test("isRateLimitedError returns false for non-rate-limited errors", async () => {
    expect(isRateLimitedError(new Error("generic error"))).toBe(false);
    expect(isRateLimitedError(null)).toBe(false);
    expect(isRateLimitedError("string error")).toBe(false);
  });
});
