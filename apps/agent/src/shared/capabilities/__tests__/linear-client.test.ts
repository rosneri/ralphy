import { afterEach, describe, expect, test } from "bun:test";
import {
  fetchMentionScanIssues,
  formatLinearError,
  isRateLimitedError,
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
    if (!r) throw new Error(`unexpected extra fetch call (#${i})`);
    return r;
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  linearRequestInternals.sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { count: () => i, sleeps: () => sleeps };
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
