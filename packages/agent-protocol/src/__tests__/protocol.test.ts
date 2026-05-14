import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type AgentEvent, type AgentRequest } from "../index";

describe("PROTOCOL_VERSION", () => {
  test("is a non-empty string", () => {
    expect(typeof PROTOCOL_VERSION).toBe("string");
    expect(PROTOCOL_VERSION.length).toBeGreaterThan(0);
  });
});

describe("AgentRequest", () => {
  test("accepts run with required fields", () => {
    const req: AgentRequest = {
      type: "run",
      prompt: "do the thing",
      model: "opus",
      cwd: "/tmp/x",
    };
    expect(req.type).toBe("run");
  });

  test("accepts run with resumeSessionId", () => {
    const req: AgentRequest = {
      type: "run",
      prompt: "resume",
      model: "opus",
      cwd: "/tmp/x",
      resumeSessionId: "abc-123",
    };
    expect(req.type === "run" && req.resumeSessionId).toBe("abc-123");
  });

  test("accepts cancel", () => {
    const req: AgentRequest = { type: "cancel" };
    expect(req.type).toBe("cancel");
  });
});

describe("AgentEvent", () => {
  test("each variant is constructible", () => {
    const events: AgentEvent[] = [
      { type: "hello", protocolVersion: PROTOCOL_VERSION },
      { type: "session", id: "s1" },
      { type: "text", chunk: "hi" },
      { type: "tool_use", name: "Read", input: { path: "/x" } },
      { type: "tool_result", name: "Read", ok: true },
      { type: "usage", inputTokens: 1, outputTokens: 2, costUsd: 0.01 },
      { type: "rate_limited" },
      { type: "rate_limited", retryAfterMs: 5000 },
      { type: "result", exitCode: 0 },
    ];
    expect(events).toHaveLength(9);
  });
});
