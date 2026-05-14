import { describe, expect, test } from "bun:test";
import type { IterationUsage } from "@ralphy/types";
import { buildClaudeArgs, isRateLimitText, parseClaudeLine } from "../index";

describe("buildClaudeArgs", () => {
  test("emits the stream-json transport flags", () => {
    const args = buildClaudeArgs("opus");
    expect(args).toEqual([
      "-p",
      "-",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  test("appends --resume when a session id is provided", () => {
    const args = buildClaudeArgs("opus", "sess-123");
    expect(args).toContain("--resume");
    expect(args).toContain("sess-123");
    expect(args[args.length - 2]).toBe("--resume");
    expect(args[args.length - 1]).toBe("sess-123");
  });
});

describe("isRateLimitText", () => {
  test("detects known rate-limit phrasings (case-insensitive)", () => {
    expect(isRateLimitText("You've hit your limit, try again later")).toBe(true);
    expect(isRateLimitText("RATE LIMIT exceeded")).toBe(true);
    expect(isRateLimitText("HTTP 429: Too many requests")).toBe(true);
  });

  test("returns false for unrelated text", () => {
    expect(isRateLimitText("All good here")).toBe(false);
    expect(isRateLimitText("")).toBe(false);
  });
});

describe("parseClaudeLine", () => {
  function makeState() {
    return {
      turnCount: 0,
      toolCount: 0,
      gotResult: false,
      usage: null as IterationUsage | null,
    };
  }

  test("parses init event into a session event", () => {
    const state = makeState();
    const events = parseClaudeLine(
      JSON.stringify({
        type: "system",
        subtype: "init",
        model: "claude-test",
        session_id: "abc12345xyz",
        claude_code_version: "1.0.0",
        tools: ["Read", "Edit"],
      }),
      state,
    );
    expect(events).toEqual([
      {
        type: "session",
        model: "claude-test",
        sessionId: "abc12345",
        version: "1.0.0",
        toolCount: 2,
      },
    ]);
  });

  test("parses result event and updates usage", () => {
    const state = makeState();
    const events = parseClaudeLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        total_cost_usd: 0.12345,
        duration_ms: 1500,
        num_turns: 3,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
        },
      }),
      state,
    );
    expect(state.gotResult).toBe(true);
    expect(state.usage?.input_tokens).toBe(100);
    expect(events[0]).toMatchObject({ type: "result", cost: 0.12, turns: 3, inputTokens: 100 });
  });

  test("returns no events for empty or non-JSON lines", () => {
    expect(parseClaudeLine("", makeState())).toEqual([]);
    expect(parseClaudeLine("not json", makeState())).toEqual([]);
    expect(parseClaudeLine(JSON.stringify({ noType: true }), makeState())).toEqual([]);
  });
});
