import { afterEach, describe, expect, test } from "bun:test";
import { fetchAttachmentsForIssues } from "../shared/capabilities/linear-client";

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
    return new Response(JSON.stringify({ data: handler(body) }), {
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

describe("fetchAttachmentsForIssues", () => {
  test("returns empty map and issues no fetch when issueIds is empty", async () => {
    const { calls } = stubFetch(() => ({ issues: { nodes: [] } }));
    const result = await fetchAttachmentsForIssues("key", []);
    expect(result.size).toBe(0);
    expect(calls.length).toBe(0);
  });

  test("issues exactly one request and returns map keyed by issue id", async () => {
    const { calls } = stubFetch((body) => {
      expect(body.variables["ids"]).toEqual(["i1", "i2", "i3"]);
      return {
        issues: {
          nodes: [
            {
              id: "i1",
              attachments: {
                nodes: [
                  {
                    id: "a1",
                    url: "https://github.com/o/r/pull/1",
                    sourceType: "github",
                    title: "PR #1",
                  },
                ],
              },
            },
            { id: "i2", attachments: { nodes: [] } },
            {
              id: "i3",
              attachments: {
                nodes: [{ id: "a3", url: "https://example.com/x", sourceType: null, title: null }],
              },
            },
          ],
        },
      };
    });
    const result = await fetchAttachmentsForIssues("key", ["i1", "i2", "i3"]);
    expect(calls.length).toBe(1);
    expect(calls[0]!.query).toContain("IssuesAttachments");
    expect(result.get("i1")?.[0]?.url).toBe("https://github.com/o/r/pull/1");
    expect(result.get("i2")).toEqual([]);
    expect(result.get("i3")?.[0]?.id).toBe("a3");
  });

  test("omits issue ids that Linear does not return", async () => {
    stubFetch(() => ({
      issues: { nodes: [{ id: "i1", attachments: { nodes: [] } }] },
    }));
    const result = await fetchAttachmentsForIssues("key", ["i1", "i-missing"]);
    expect(result.has("i1")).toBe(true);
    expect(result.has("i-missing")).toBe(false);
    expect(result.get("i-missing") ?? []).toEqual([]);
  });
});
