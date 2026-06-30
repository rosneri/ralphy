import { afterEach, describe, expect, test } from "bun:test";
import {
  createIssueComment,
  deleteIssueComment,
  updateIssueComment,
} from "../shared/capabilities/linear-client/comments";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

interface Call {
  query: string;
  variables: Record<string, unknown>;
}

function stubFetch(handler: (body: Call) => unknown): { calls: Call[] } {
  const calls: Call[] = [];
  const fake: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Call;
    calls.push(body);
    const data = handler(body);
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  globalThis.fetch = fake as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createIssueComment", () => {
  test("posts commentCreate mutation with issueId + body, returns id", async () => {
    const { calls } = stubFetch(() => ({
      commentCreate: { success: true, comment: { id: "c-1" } },
    }));
    const id = await createIssueComment("api-key", "issue-1", "hello world");
    expect(id).toBe("c-1");
    expect(calls.length).toBe(1);
    expect(calls[0]!.query).toContain("commentCreate");
    expect(calls[0]!.query).toContain("comment { id }");
    expect(calls[0]!.variables).toEqual({ issueId: "issue-1", body: "hello world" });
  });

  test("throws when no id is returned", async () => {
    stubFetch(() => ({ commentCreate: { success: true, comment: null } }));
    await expect(createIssueComment("k", "i", "b")).rejects.toThrow(/no comment id/);
  });
});

describe("updateIssueComment", () => {
  test("posts commentUpdate with id + body in input", async () => {
    const { calls } = stubFetch(() => ({ commentUpdate: { success: true } }));
    await updateIssueComment("api-key", "c-1", "new body");
    expect(calls.length).toBe(1);
    expect(calls[0]!.query).toContain("commentUpdate");
    expect(calls[0]!.query).toContain("input: { body: $body }");
    expect(calls[0]!.variables).toEqual({ id: "c-1", body: "new body" });
  });

  test("surfaces Linear errors[] from the response", async () => {
    const fake: FetchLike = async () =>
      new Response(JSON.stringify({ errors: [{ message: "Entity not found" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    globalThis.fetch = fake as typeof fetch;
    await expect(updateIssueComment("k", "missing", "body")).rejects.toThrow(/Linear API/);
  });
});

describe("deleteIssueComment", () => {
  test("posts commentDelete mutation with id", async () => {
    const { calls } = stubFetch(() => ({ commentDelete: { success: true } }));
    await deleteIssueComment("api-key", "c-2");
    expect(calls.length).toBe(1);
    expect(calls[0]!.query).toContain("commentDelete");
    expect(calls[0]!.variables).toEqual({ id: "c-2" });
  });
});
