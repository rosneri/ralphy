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

  test("emits session-unknown when init lacks a model", () => {
    const events = parseClaudeLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "deadbeefcafe" }),
      makeState(),
    );
    expect(events).toEqual([{ type: "session-unknown", sessionId: "deadbeef" }]);
  });

  test("parses task_started into an agent event", () => {
    const events = parseClaudeLine(
      JSON.stringify({ type: "system", subtype: "task_started", description: "do the thing" }),
      makeState(),
    );
    expect(events).toEqual([{ type: "agent", description: "do the thing" }]);
  });

  test("parses assistant text, tool_use, and thinking blocks", () => {
    const state = makeState();
    const events = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", name: "Read", input: { file_path: "/a/b/c.ts" } },
            { type: "thinking", thinking: "line1\nline2\nline3\nline4" },
          ],
        },
      }),
      state,
    );
    expect(state.turnCount).toBe(1);
    expect(state.toolCount).toBe(1);
    expect(events).toEqual([
      { type: "text", text: "hello" },
      { type: "tool-start", name: "Read", summary: { kind: "file", name: "c.ts" } },
      { type: "thinking", preview: "line1\nline2\nline3", totalLines: 4 },
    ]);
  });

  test("emits bare thinking event when content is empty", () => {
    const events = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "" }] },
      }),
      makeState(),
    );
    expect(events).toEqual([{ type: "thinking" }]);
  });

  test("extracts tool input summaries across known shapes", () => {
    const cases: Array<[Record<string, unknown>, unknown]> = [
      [{ command: "ls -la\nfoo" }, { kind: "command", text: "ls -la" }],
      [
        { pattern: "foo", path: "src/lib/x.ts" },
        { kind: "search", pattern: "foo", path: "x.ts" },
      ],
      [{ query: "search me" }, { kind: "search", pattern: "search me" }],
      [{ url: "https://example.com" }, { kind: "url", url: "https://example.com" }],
      [{ prompt: "first\nsecond" }, { kind: "prompt", text: "first" }],
      [{ old_string: "x" }, { kind: "edit" }],
      [{ content: "x" }, { kind: "write" }],
    ];
    for (const [input, expected] of cases) {
      const events = parseClaudeLine(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "T", input }] },
        }),
        makeState(),
      );
      expect(events[0]).toMatchObject({ type: "tool-start", name: "T", summary: expected });
    }
  });

  test("falls back to compact key=value summary for unknown tool inputs", () => {
    const events = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Mcp", input: { foo: "bar", count: 3 } }],
        },
      }),
      makeState(),
    );
    expect(events[0]).toMatchObject({
      type: "tool-start",
      summary: { kind: "raw", text: "foo=bar  count=3" },
    });
  });

  test("omits summary when tool input is empty", () => {
    const events = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Noop", input: {} }] },
      }),
      makeState(),
    );
    expect(events[0]).toEqual({ type: "tool-start", name: "Noop" });
  });

  test("parses tool_result with string content and truncation", () => {
    const longLines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const events = parseClaudeLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: longLines }],
        },
      }),
      makeState(),
    );
    expect(events[0]).toEqual({ type: "tool-end" });
    expect(events[1]).toMatchObject({
      type: "tool-result-preview",
      lines: ["line 0", "line 1", "line 2", "line 3", "line 4", "line 5"],
      truncated: 4,
    });
  });

  test("parses tool_result with array text blocks", () => {
    const events = parseClaudeLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              content: [
                { type: "text", text: "a" },
                { type: "text", text: "b" },
              ],
            },
          ],
        },
      }),
      makeState(),
    );
    expect(events).toEqual([
      { type: "tool-end" },
      { type: "tool-result-preview", lines: ["a", "b"] },
    ]);
  });

  test("emits result-error for failed result events", () => {
    const state = makeState();
    const events = parseClaudeLine(
      JSON.stringify({ type: "result", subtype: "error", result: "boom" }),
      state,
    );
    expect(state.gotResult).toBe(true);
    expect(events).toEqual([{ type: "result-error", message: "boom" }]);
  });
});
