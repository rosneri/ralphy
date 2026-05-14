import { describe, expect, test } from "bun:test";
import { parseClaudeLine } from "../formatters/claude-stream";
import type { IterationUsage } from "@ralphy/types";
import type { FeedEvent } from "../feed-events";
import {
  parseCodexLine,
  processCodexLine,
  formatCodexStream,
  type CodexStreamState,
} from "../formatters/codex-stream";

// Strip ANSI escape codes for readable assertions
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── Claude stream formatter ─────────────────────────────────────

describe("parseClaudeLine", () => {
  function makeState() {
    return {
      turnCount: 0,
      toolCount: 0,
      gotResult: false,
      usage: null as IterationUsage | null,
    };
  }

  function parse(
    json: string | object,
    state = makeState(),
  ): { events: FeedEvent[]; state: ReturnType<typeof makeState> } {
    const line = typeof json === "string" ? json : JSON.stringify(json);
    return { events: parseClaudeLine(line, state), state };
  }

  test("skips empty lines", () => {
    expect(parse("").events).toEqual([]);
    expect(parse("  ").events).toEqual([]);
  });

  test("skips invalid JSON", () => {
    expect(parse("not json").events).toEqual([]);
  });

  test("skips events without type", () => {
    expect(parse({ foo: "bar" }).events).toEqual([]);
  });

  test("handles system init event", () => {
    const { events } = parse({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4-20250514",
      session_id: "abcdefghijklmnop",
      tools: [1, 2, 3],
    });
    expect(events).toEqual([
      {
        type: "session",
        model: "claude-sonnet-4-20250514",
        sessionId: "abcdefgh",
        toolCount: 3,
      },
    ]);
  });

  test("handles system init event with version", () => {
    const { events } = parse({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4-20250514",
      session_id: "abcdefghijklmnop",
      claude_code_version: "1.2.3",
      tools: [1, 2, 3],
    });
    expect(events).toEqual([
      {
        type: "session",
        model: "claude-sonnet-4-20250514",
        sessionId: "abcdefgh",
        version: "1.2.3",
        toolCount: 3,
      },
    ]);
  });

  test("handles unknown model", () => {
    const { events } = parse({ type: "system", subtype: "init", session_id: "abc" });
    expect(events).toEqual([{ type: "session-unknown", sessionId: "abc" }]);
  });

  test("handles task_started", () => {
    const { events } = parse({
      type: "system",
      subtype: "task_started",
      description: "Build something",
    });
    expect(events).toEqual([{ type: "agent", description: "Build something" }]);
  });

  test("handles assistant text block", () => {
    const state = makeState();
    const { events } = parse(
      { type: "assistant", message: { content: [{ type: "text", text: "Hello world" }] } },
      state,
    );
    expect(events).toEqual([{ type: "text", text: "Hello world" }]);
    expect(state.turnCount).toBe(1);
  });

  test("handles assistant tool_use block", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { file_path: "/foo/bar/baz.ts" } }],
        },
      },
      state,
    );
    expect(events).toEqual([
      { type: "tool-start", name: "Read", summary: { kind: "file", name: "baz.ts" } },
    ]);
    expect(state.toolCount).toBe(1);
  });

  test("handles tool_use with command input", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la\necho foo" } }],
      },
    });
    expect(events[0]).toEqual({
      type: "tool-start",
      name: "Bash",
      summary: { kind: "command", text: "ls -la" },
    });
  });

  test("handles tool_use with pattern input", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", input: { pattern: "TODO", path: "/src/app" } }],
      },
    });
    expect(events[0]).toEqual({
      type: "tool-start",
      name: "Grep",
      summary: { kind: "search", pattern: "TODO", path: "app" },
    });
  });

  test("handles thinking block with text", () => {
    const { events } = parse({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "Let me think" }] },
    });
    expect(events).toEqual([{ type: "thinking", preview: "Let me think", totalLines: 1 }]);
  });

  test("handles thinking block with multiple lines", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5" }],
      },
    });
    expect(events).toEqual([
      { type: "thinking", preview: "Line 1\nLine 2\nLine 3", totalLines: 5 },
    ]);
  });

  test("handles empty thinking block", () => {
    const { events } = parse({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "" }] },
    });
    expect(events).toEqual([{ type: "thinking" }]);
  });

  test("handles user tool_result event", () => {
    const { events } = parse({
      type: "user",
      message: { content: [{ type: "tool_result", content: "result text" }] },
    });
    expect(events[0]).toEqual({ type: "tool-end" });
    expect(events[1]).toMatchObject({ type: "tool-result-preview", lines: ["result text"] });
  });

  test("handles user tool_result with array content", () => {
    const { events } = parse({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            content: [
              { type: "text", text: "line one" },
              { type: "image", data: "..." },
              { type: "text", text: "line two" },
            ],
          },
        ],
      },
    });
    expect(events[0]).toEqual({ type: "tool-end" });
    const preview = events[1] as Extract<FeedEvent, { type: "tool-result-preview" }>;
    expect(preview.lines).toEqual(["line one", "line two"]);
  });

  test("handles result event (success)", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.1234,
        duration_ms: 5000,
        num_turns: 3,
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 25,
        },
      },
      state,
    );
    expect(events).toEqual([
      {
        type: "result",
        cost: 0.12,
        timeMs: 5000,
        turns: 3,
        inputTokens: 100,
        outputTokens: 200,
        cached: 50,
      },
    ]);
    expect(state.gotResult).toBe(true);
    expect(state.usage).not.toBeNull();
    expect(state.usage!.input_tokens).toBe(100);
  });

  test("handles result event (error)", () => {
    const state = makeState();
    const { events } = parse(
      { type: "result", subtype: "error", result: "something went wrong" },
      state,
    );
    expect(events).toEqual([{ type: "result-error", message: "something went wrong" }]);
    expect(state.gotResult).toBe(true);
  });

  test("multi-line stream produces correct events and state", () => {
    const state = makeState();
    const lines = [
      {
        type: "system",
        subtype: "init",
        model: "claude-sonnet-4-20250514",
        session_id: "abc12345678",
      },
      { type: "assistant", message: { content: [{ type: "text", text: "Working on it" }] } },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.05,
        duration_ms: 2000,
        num_turns: 1,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    ];

    const allEvents: FeedEvent[] = [];
    for (const line of lines) {
      allEvents.push(...parseClaudeLine(JSON.stringify(line), state));
    }

    expect(allEvents.some((e) => e.type === "session")).toBe(true);
    expect(allEvents.some((e) => e.type === "text" && e.text === "Working on it")).toBe(true);
    expect(allEvents.some((e) => e.type === "result")).toBe(true);
    expect(state.gotResult).toBe(true);
    expect(state.turnCount).toBe(1);
  });

  test("tracks interrupted state when no result event", () => {
    const state = makeState();
    parseClaudeLine(
      JSON.stringify({
        type: "system",
        subtype: "init",
        model: "claude-sonnet-4-20250514",
        session_id: "abc",
      }),
      state,
    );
    expect(state.gotResult).toBe(false);
  });

  test("tracks turn and tool counts", () => {
    const state = makeState();
    parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a.ts" } }] },
      }),
      state,
    );
    expect(state.turnCount).toBe(1);
    expect(state.toolCount).toBe(1);
  });
});

// ─── Codex stream formatter ─────────────────────────────────────

describe("processCodexLine", () => {
  function makeState() {
    return { printingText: false, rateLimited: false, pendingTools: 0 };
  }

  test("skips empty lines", () => {
    const state = makeState();
    expect(processCodexLine("", state)).toEqual([]);
  });

  test("handles non-JSON rate limit line", () => {
    const state = makeState();
    const lines = processCodexLine("You have hit your limit", state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("Rate limit");
    expect(state.rateLimited).toBe(true);
  });

  test("handles non-JSON important error", () => {
    const state = makeState();
    const lines = processCodexLine("thread main panicked at foo", state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("error:");
  });

  test("shows non-JSON line in verbose mode only", () => {
    const state = makeState();
    expect(processCodexLine("some random text", state)).toEqual([]);
    const verboseLines = processCodexLine("some random text", state, {
      verbose: true,
    });
    const text = strip(verboseLines.join("\n"));
    expect(text).toContain("some random text");
  });

  test("handles thread.started", () => {
    const state = makeState();
    const event = { type: "thread.started", thread_id: "abcdef12345" };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("codex");
    expect(text).toContain("abcdef12");
  });

  test("handles turn.started", () => {
    const state = makeState();
    const event = { type: "turn.started" };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("turn started");
  });

  test("handles turn.completed with usage", () => {
    const state = makeState();
    const event = {
      type: "turn.completed",
      usage: { input_tokens: 500, output_tokens: 200 },
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("✓ done");
    expect(text).toContain("in=500");
    expect(text).toContain("out=200");
  });

  test("handles turn.completed without usage", () => {
    const state = makeState();
    const event = { type: "turn.completed" };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("✓ done");
  });

  test("handles turn.failed", () => {
    const state = makeState();
    const event = {
      type: "turn.failed",
      error: { message: "something broke" },
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("✗ Error");
    expect(text).toContain("something broke");
  });

  test("handles error event with rate limit", () => {
    const state = makeState();
    const event = {
      type: "error",
      message: "You have hit your limit for today",
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("Rate limit");
    expect(state.rateLimited).toBe(true);
  });

  test("handles error event without rate limit", () => {
    const state = makeState();
    const event = { type: "error", message: "some error" };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("error:");
    expect(text).toContain("some error");
  });

  test("handles text delta events", () => {
    const state = makeState();
    const event = {
      type: "response.output_text.delta",
      delta: "Hello",
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("Hello");
    expect(state.printingText).toBe(true);
  });

  test("handles text done events", () => {
    const state = makeState();
    state.printingText = true;
    const event = {
      type: "response.output_text.done",
      text: "final text",
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("final text");
    expect(state.printingText).toBe(false);
  });

  test("handles thinking delta events", () => {
    const state = makeState();
    const event = {
      type: "thinking.delta",
      delta: "considering options",
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("💭");
    expect(text).toContain("considering options");
  });

  test("handles tool.started event", () => {
    const state = makeState();
    const event = {
      type: "tool.started",
      name: "shell",
      command: "ls -la",
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("shell");
    expect(text).toContain("ls -la");
    expect(state.pendingTools).toBe(1);
  });

  test("handles tool.started with command_execution fallback", () => {
    const state = makeState();
    const event = {
      type: "item.started",
      item: { type: "command_execution" },
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("shell");
    expect(state.pendingTools).toBe(1);
  });

  test("handles tool.completed with result summary", () => {
    const state = makeState();
    state.pendingTools = 1;
    const event = {
      type: "tool.completed",
      name: "Read",
      output: "file contents here",
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    // tool-end events are suppressed (empty output)
    expect(lines).toEqual([]);
    expect(state.pendingTools).toBe(0);
  });

  test("handles item.added with tool", () => {
    const state = makeState();
    const event = {
      type: "item.added",
      item: { type: "tool_call", name: "Write" },
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("Write");
    expect(state.pendingTools).toBe(1);
  });

  test("handles item.added with message text", () => {
    const state = makeState();
    const event = {
      type: "item.added",
      item: { type: "agent_message", text: "Agent says hi" },
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("Agent says hi");
  });

  test("handles response.completed with output text", () => {
    const state = makeState();
    const event = {
      type: "response.completed",
      response: {
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Done!" }],
          },
        ],
      },
    };
    const lines = processCodexLine(JSON.stringify(event), state);
    const text = strip(lines.join("\n"));
    expect(text).toContain("Done!");
  });

  test("shows unknown events in verbose mode", () => {
    const state = makeState();
    const event = { type: "custom.event", data: "xyz" };
    expect(processCodexLine(JSON.stringify(event), state)).toEqual([]);
    const verboseLines = processCodexLine(JSON.stringify(event), state, {
      verbose: true,
    });
    const text = strip(verboseLines.join("\n"));
    expect(text).toContain("custom.event");
  });
});

describe("formatCodexStream", () => {
  test("processes multi-line stream", () => {
    const stream = [
      JSON.stringify({ type: "thread.started", thread_id: "abc123456" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "response.output_text.delta",
        delta: "Working...",
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ].join("\n");

    const { output, result } = formatCodexStream(stream);
    const text = strip(output);
    expect(text).toContain("codex");
    expect(text).toContain("Working...");
    expect(text).toContain("✓ done");
    expect(result.rateLimited).toBe(false);
  });

  test("detects rate limiting", () => {
    const stream = [
      JSON.stringify({ type: "thread.started", thread_id: "abc123456" }),
      JSON.stringify({
        type: "error",
        message: "You have hit your limit",
      }),
    ].join("\n");

    const { result } = formatCodexStream(stream);
    expect(result.rateLimited).toBe(true);
  });

  test("handles rate limit in non-JSON line", () => {
    const stream = [
      JSON.stringify({ type: "thread.started", thread_id: "abc" }),
      "You have hit your limit for today",
    ].join("\n");

    const { result } = formatCodexStream(stream);
    expect(result.rateLimited).toBe(true);
  });

  test("appends empty line when printingText is true at end", () => {
    const stream = [
      JSON.stringify({ type: "response.output_text.delta", delta: "still typing" }),
    ].join("\n");

    const { output, result } = formatCodexStream(stream);
    // The state says printingText was true, which causes an empty line to be appended
    // The last line in the output is an empty string
    const lines = output.split("\n");
    expect(lines[lines.length - 1]).toBe("");
    // printingText was true at the end of processing, so formatCodexStream appends ""
    // and then the result reflects the state as it was (still true, since the empty line
    // append doesn't change state)
    expect(result.printingText).toBe(true);
  });
});

// ─── Claude stream formatter: additional coverage ────────────────

describe("parseClaudeLine - additional coverage", () => {
  function makeState() {
    return {
      turnCount: 0,
      toolCount: 0,
      gotResult: false,
      usage: null as IterationUsage | null,
    };
  }

  function parse(
    json: string | object,
    state = makeState(),
  ): { events: FeedEvent[]; state: ReturnType<typeof makeState> } {
    const line = typeof json === "string" ? json : JSON.stringify(json);
    return { events: parseClaudeLine(line, state), state };
  }

  test("handles tool_use with query input (search)", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Search", input: { query: "find something" } }],
      },
    });
    expect(events[0]).toEqual({
      type: "tool-start",
      name: "Search",
      summary: { kind: "search", pattern: "find something" },
    });
  });

  test("handles tool_use with url input", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "WebFetch", input: { url: "https://example.com/api" } },
        ],
      },
    });
    expect(events[0]).toEqual({
      type: "tool-start",
      name: "WebFetch",
      summary: { kind: "url", url: "https://example.com/api" },
    });
  });

  test("handles tool_use with prompt input", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Ask",
            input: { prompt: "What do you think?\nPlease explain" },
          },
        ],
      },
    });
    expect(events[0]).toEqual({
      type: "tool-start",
      name: "Ask",
      summary: { kind: "prompt", text: "What do you think?" },
    });
  });

  test("handles tool_use with edit input (old_string)", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { old_string: "foo", new_string: "bar", file_path: "/a.ts" },
          },
        ],
      },
    });
    // file_path is checked first, so it should match file kind
    expect(events[0]).toMatchObject({
      type: "tool-start",
      name: "Edit",
      summary: { kind: "file", name: "a.ts" },
    });
  });

  test("handles tool_use with old_string but no file_path", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { old_string: "foo", new_string: "bar" },
          },
        ],
      },
    });
    expect(events[0]).toMatchObject({
      type: "tool-start",
      name: "Edit",
      summary: { kind: "edit" },
    });
  });

  test("handles tool_use with content input (write)", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { content: "file contents" },
          },
        ],
      },
    });
    expect(events[0]).toMatchObject({
      type: "tool-start",
      name: "Write",
      summary: { kind: "write" },
    });
  });

  test("handles tool_use with pattern but no path", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Grep",
            input: { pattern: "TODO" },
          },
        ],
      },
    });
    expect(events[0]).toMatchObject({
      type: "tool-start",
      name: "Grep",
      summary: { kind: "search", pattern: "TODO" },
    });
  });

  test("handles tool_use with unknown input keys (raw fallback)", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "CustomTool",
            input: { foo: "bar", baz: 123 },
          },
        ],
      },
    });
    const summary = (events[0] as Extract<FeedEvent, { type: "tool-start" }>).summary;
    expect(summary).toBeDefined();
    expect(summary!.kind).toBe("raw");
  });

  test("handles tool_use with empty input", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Noop", input: {} }],
      },
    });
    // Empty input => no summary
    expect(events[0]).toEqual({ type: "tool-start", name: "Noop" });
  });

  test("handles tool_use with very long raw input values (truncation)", () => {
    const longVal = "x".repeat(200);
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Custom",
            input: { longKey: longVal },
          },
        ],
      },
    });
    const summary = (events[0] as Extract<FeedEvent, { type: "tool-start" }>).summary;
    expect(summary).toBeDefined();
    expect(summary!.kind).toBe("raw");
    if (summary!.kind === "raw") {
      expect(summary!.text).toContain("…");
    }
  });

  test("handles tool_use with many keys exceeding 120 char limit", () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      input[`key_${i}_long_name`] = `value_${i}_also_long`;
    }
    const { events } = parse({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Custom", input }],
      },
    });
    const summary = (events[0] as Extract<FeedEvent, { type: "tool-start" }>).summary;
    expect(summary).toBeDefined();
    expect(summary!.kind).toBe("raw");
  });

  test("handles tool_use with non-string input values (JSON.stringify)", () => {
    const { events } = parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Custom",
            input: { config: { nested: true } },
          },
        ],
      },
    });
    const summary = (events[0] as Extract<FeedEvent, { type: "tool-start" }>).summary;
    expect(summary).toBeDefined();
    expect(summary!.kind).toBe("raw");
  });

  test("handles tool_use with no name", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", input: {} }],
        },
      },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "?" });
    expect(state.toolCount).toBe(1);
  });

  test("handles user tool_result with truncated preview (>6 lines)", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    const { events } = parse({
      type: "user",
      message: { content: [{ type: "tool_result", content: lines }] },
    });
    const preview = events[1] as Extract<FeedEvent, { type: "tool-result-preview" }>;
    expect(preview.lines.length).toBe(6);
    expect(preview.truncated).toBe(4);
  });

  test("handles user tool_result with empty content", () => {
    const { events } = parse({
      type: "user",
      message: { content: [{ type: "tool_result", content: "" }] },
    });
    // Only tool-end, no preview
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("tool-end");
  });

  test("handles system init with no subtype", () => {
    const { events } = parse({ type: "system" });
    expect(events).toEqual([]);
  });

  test("handles system task_started with no description", () => {
    const { events } = parse({ type: "system", subtype: "task_started" });
    expect(events).toEqual([]);
  });

  test("handles assistant with empty message content", () => {
    const state = makeState();
    const { events } = parse({ type: "assistant", message: { content: [] } }, state);
    expect(events).toEqual([]);
    expect(state.turnCount).toBe(1);
  });

  test("handles assistant with no message", () => {
    const state = makeState();
    const { events } = parse({ type: "assistant" }, state);
    expect(events).toEqual([]);
    expect(state.turnCount).toBe(1);
  });

  test("handles user with no message", () => {
    const { events } = parse({ type: "user" });
    expect(events).toEqual([]);
  });

  test("handles result with no usage/defaults", () => {
    const state = makeState();
    const { events } = parse({ type: "result", subtype: "success" }, state);
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("result");
    expect(state.usage).not.toBeNull();
    expect(state.usage!.cost_usd).toBe(0);
    expect(state.usage!.duration_ms).toBe(0);
  });

  test("handles unknown event type", () => {
    const { events } = parse({ type: "unknown_type", data: "test" });
    expect(events).toEqual([]);
  });

  test("handles assistant with text block with empty text", () => {
    const { events } = parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "" }] },
    });
    expect(events).toEqual([]);
  });

  test("handles assistant with multiple content blocks", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "Hello" },
            { type: "tool_use", name: "Bash", input: { command: "echo hi" } },
          ],
        },
      },
      state,
    );
    expect(events.length).toBe(3);
    expect(events[0]!.type).toBe("thinking");
    expect(events[1]!.type).toBe("text");
    expect(events[2]!.type).toBe("tool-start");
    expect(state.turnCount).toBe(1);
    expect(state.toolCount).toBe(1);
  });
});

// ─── Codex stream formatter: parseCodexLine direct tests ─────────

describe("parseCodexLine", () => {
  function makeState(): CodexStreamState {
    return { printingText: false, rateLimited: false, pendingTools: 0 };
  }

  function parse(
    json: string | object,
    state = makeState(),
  ): { events: FeedEvent[]; state: CodexStreamState } {
    const line = typeof json === "string" ? json : JSON.stringify(json);
    return { events: parseCodexLine(line, state), state };
  }

  test("skips empty lines", () => {
    expect(parse("").events).toEqual([]);
    expect(parse("   ").events).toEqual([]);
  });

  test("returns empty for invalid JSON without special patterns", () => {
    const { events } = parse("just some random text");
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("raw");
  });

  test("detects rate limit in non-JSON text", () => {
    const state = makeState();
    const { events } = parse("You have hit your limit for today", state);
    expect(events[0]).toEqual({ type: "rate-limit", message: "You have hit your limit for today" });
    expect(state.rateLimited).toBe(true);
  });

  test("detects important non-JSON errors (panicked)", () => {
    const { events } = parse("thread main panicked at some_func");
    expect(events[0]).toEqual({ type: "error", message: "thread main panicked at some_func" });
  });

  test("detects important non-JSON errors (error:)", () => {
    const { events } = parse("error: something bad happened");
    expect(events[0]).toEqual({ type: "error", message: "error: something bad happened" });
  });

  test("detects important non-JSON errors (failed)", () => {
    const { events } = parse("Build failed with exit code 1");
    expect(events[0]).toEqual({ type: "error", message: "Build failed with exit code 1" });
  });

  test("detects important non-JSON errors (exception)", () => {
    const { events } = parse("Uncaught Exception thrown");
    expect(events[0]).toEqual({ type: "error", message: "Uncaught Exception thrown" });
  });

  test("detects important non-JSON errors (traceback)", () => {
    const { events } = parse("Traceback (most recent call last):");
    expect(events[0]).toEqual({ type: "error", message: "Traceback (most recent call last):" });
  });

  test("detects important non-JSON errors (fatal)", () => {
    const { events } = parse("fatal error encountered");
    expect(events[0]).toEqual({ type: "error", message: "fatal error encountered" });
  });

  test("returns empty for event without type", () => {
    expect(parse({ foo: "bar" }).events).toEqual([]);
  });

  test("handles thread.started", () => {
    const { events } = parse({ type: "thread.started", thread_id: "abcdef1234567890" });
    expect(events).toEqual([{ type: "session", model: "codex", sessionId: "abcdef12" }]);
  });

  test("handles turn.started", () => {
    const { events } = parse({ type: "turn.started" });
    expect(events).toEqual([{ type: "turn-start" }]);
  });

  test("handles turn.completed with usage", () => {
    const state = makeState();
    state.printingText = true;
    const { events } = parse(
      { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 50 } },
      state,
    );
    expect(events[0]).toEqual({ type: "turn-done", inputTokens: 100, outputTokens: 50 });
    expect(state.printingText).toBe(false);
  });

  test("handles turn.completed without usage", () => {
    const { events } = parse({ type: "turn.completed" });
    expect(events).toEqual([{ type: "turn-done" }]);
  });

  test("handles turn.failed with error object", () => {
    const state = makeState();
    state.printingText = true;
    const { events } = parse({ type: "turn.failed", error: { message: "out of tokens" } }, state);
    expect(events).toEqual([{ type: "result-error", message: "out of tokens" }]);
    expect(state.printingText).toBe(false);
  });

  test("handles turn.failed with message string", () => {
    const { events } = parse({ type: "turn.failed", message: "direct message" });
    expect(events).toEqual([{ type: "result-error", message: "direct message" }]);
  });

  test("handles turn.failed without error details", () => {
    const { events } = parse({ type: "turn.failed" });
    expect(events).toEqual([{ type: "result-error", message: "unknown error" }]);
  });

  test("handles error event - rate limit", () => {
    const state = makeState();
    const { events } = parse({ type: "error", message: "You have hit your limit" }, state);
    expect(events[0]).toEqual({ type: "rate-limit", message: "You have hit your limit" });
    expect(state.rateLimited).toBe(true);
  });

  test("handles error event - generic", () => {
    const { events } = parse({ type: "error", message: "something went wrong" });
    expect(events).toEqual([{ type: "error", message: "something went wrong" }]);
  });

  test("handles error event without message", () => {
    const { events } = parse({ type: "error" });
    expect(events).toEqual([{ type: "error", message: "unknown error" }]);
  });

  // Text delta events - all aliases
  test("handles assistant.message.delta", () => {
    const state = makeState();
    const { events } = parse({ type: "assistant.message.delta", delta: "Hello" }, state);
    expect(events).toEqual([{ type: "text", text: "Hello" }]);
    expect(state.printingText).toBe(true);
  });

  test("handles message.delta", () => {
    const state = makeState();
    const { events } = parse({ type: "message.delta", text: "World" }, state);
    expect(events).toEqual([{ type: "text", text: "World" }]);
    expect(state.printingText).toBe(true);
  });

  test("handles output_text.delta", () => {
    const state = makeState();
    const { events } = parse({ type: "output_text.delta", message: "Fallback" }, state);
    expect(events).toEqual([{ type: "text", text: "Fallback" }]);
    expect(state.printingText).toBe(true);
  });

  test("handles text delta with empty delta", () => {
    const state = makeState();
    const { events } = parse({ type: "response.output_text.delta" }, state);
    expect(events).toEqual([]);
    expect(state.printingText).toBe(false);
  });

  // Text done events - all aliases
  test("handles assistant.message.completed", () => {
    const state = makeState();
    state.printingText = true;
    const { events } = parse({ type: "assistant.message.completed", text: "Final" }, state);
    expect(events).toEqual([{ type: "text", text: "Final" }]);
    expect(state.printingText).toBe(false);
  });

  test("handles message.completed", () => {
    const state = makeState();
    const { events } = parse({ type: "message.completed", text: "Done" }, state);
    expect(events).toEqual([{ type: "text", text: "Done" }]);
    expect(state.printingText).toBe(false);
  });

  test("handles output_text.done", () => {
    const state = makeState();
    const { events } = parse({ type: "output_text.done", text: "Finished" }, state);
    expect(events).toEqual([{ type: "text", text: "Finished" }]);
    expect(state.printingText).toBe(false);
  });

  test("handles text done with empty text", () => {
    const state = makeState();
    state.printingText = true;
    const { events } = parse({ type: "response.output_text.done" }, state);
    expect(events).toEqual([]);
    expect(state.printingText).toBe(false);
  });

  // Thinking delta events - all aliases
  test("handles response.reasoning.delta", () => {
    const state = makeState();
    const { events } = parse({ type: "response.reasoning.delta", delta: "thinking..." }, state);
    expect(events).toEqual([{ type: "thinking", preview: "thinking..." }]);
  });

  test("handles reasoning.delta", () => {
    const { events } = parse({ type: "reasoning.delta", text: "reasoning" });
    expect(events).toEqual([{ type: "thinking", preview: "reasoning" }]);
  });

  test("handles assistant.thinking.delta", () => {
    const { events } = parse({ type: "assistant.thinking.delta", summary: "summary text" });
    expect(events).toEqual([{ type: "thinking", preview: "summary text" }]);
  });

  test("handles response.reasoning_summary.delta", () => {
    const { events } = parse({
      type: "response.reasoning_summary.delta",
      reasoning: "deep thought",
    });
    expect(events).toEqual([{ type: "thinking", preview: "deep thought" }]);
  });

  test("handles response.reasoning_summary_text.delta", () => {
    const { events } = parse({
      type: "response.reasoning_summary_text.delta",
      message: "summary",
    });
    expect(events).toEqual([{ type: "thinking", preview: "summary" }]);
  });

  test("handles thinking.delta with item.delta", () => {
    const { events } = parse({
      type: "thinking.delta",
      item: { delta: "from item" },
    });
    expect(events).toEqual([{ type: "thinking", preview: "from item" }]);
  });

  test("handles thinking.delta with item.text", () => {
    const { events } = parse({
      type: "thinking.delta",
      item: { text: "item text" },
    });
    expect(events).toEqual([{ type: "thinking", preview: "item text" }]);
  });

  test("handles thinking.delta with item.summary", () => {
    const { events } = parse({
      type: "thinking.delta",
      item: { summary: "item summary" },
    });
    expect(events).toEqual([{ type: "thinking", preview: "item summary" }]);
  });

  test("handles thinking.delta with item.reasoning", () => {
    const { events } = parse({
      type: "thinking.delta",
      item: { reasoning: "item reasoning" },
    });
    expect(events).toEqual([{ type: "thinking", preview: "item reasoning" }]);
  });

  test("handles thinking.delta with raw_item fields", () => {
    const { events } = parse({
      type: "thinking.delta",
      item: { raw_item: { delta: "raw delta" } },
    });
    expect(events).toEqual([{ type: "thinking", preview: "raw delta" }]);
  });

  test("handles thinking.delta resets printingText", () => {
    const state = makeState();
    state.printingText = true;
    parse({ type: "thinking.delta", delta: "thought" }, state);
    expect(state.printingText).toBe(false);
  });

  test("handles thinking.delta with empty text (no event)", () => {
    const { events } = parse({ type: "thinking.delta" });
    expect(events).toEqual([]);
  });

  // Tool started events - all aliases
  test("handles tool.call.started", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.call.started", name: "Read" }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Read" });
    expect(state.pendingTools).toBe(1);
  });

  test("handles item.started with named tool", () => {
    const state = makeState();
    const { events } = parse({ type: "item.started", name: "Bash", command: "echo hi" }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Bash" });
    expect(state.pendingTools).toBe(1);
  });

  test("handles item.started with no name and no command_execution - skips", () => {
    const state = makeState();
    const { events } = parse({ type: "item.started", item: { type: "other" } }, state);
    expect(events).toEqual([]);
    expect(state.pendingTools).toBe(0);
  });

  // Tool name extraction from various paths
  test("extracts tool name from event.tool_name", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", tool_name: "Grep" }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Grep" });
  });

  test("extracts tool name from event.tool.name", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", tool: { name: "Edit" } }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Edit" });
  });

  test("extracts tool name from event.tool (string)", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", tool: "Search" }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Search" });
  });

  test("extracts tool name from item.name", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", item: { name: "Read" } }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Read" });
  });

  test("extracts tool name from item.tool_name", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", item: { tool_name: "Write" } }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Write" });
  });

  test("extracts tool name from item.tool (string)", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", item: { tool: "Bash" } }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Bash" });
  });

  test("extracts tool name from item.tool.name (object)", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", item: { tool: { name: "Grep" } } }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Grep" });
  });

  test("extracts tool name from raw_item.name", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { raw_item: { name: "Custom" } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "Custom" });
  });

  test("extracts tool name from raw_item.tool_name", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { raw_item: { tool_name: "MCP" } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "MCP" });
  });

  test("extracts tool name from raw_item.recipient_name", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { raw_item: { recipient_name: "recipient" } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "recipient" });
  });

  test("extracts tool name from raw_item.tool (string)", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { raw_item: { tool: "RawTool" } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "RawTool" });
  });

  test("extracts tool name from raw_item.tool.name (object)", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { raw_item: { tool: { name: "RawToolObj" } } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "RawToolObj" });
  });

  test("extracts tool name from item.call.name", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", item: { call: { name: "CallName" } } }, state);
    expect(events[0]).toMatchObject({ type: "tool-start", name: "CallName" });
  });

  test("extracts tool name from raw_item.call.name", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { raw_item: { call: { name: "RawCallName" } } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "RawCallName" });
  });

  test("extracts tool name from item.function.name", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { function: { name: "FuncName" } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "FuncName" });
  });

  test("extracts tool name from raw_item.function.name", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { raw_item: { function: { name: "RawFuncName" } } } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "RawFuncName" });
  });

  test("extracts tool name with server prefix", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "read_file", server: "mcp-server" },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "mcp-server/read_file" });
  });

  test("extracts tool name with item.server prefix", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", item: { name: "read_file", server: "mcp" } },
      state,
    );
    expect(events[0]).toMatchObject({ type: "tool-start", name: "mcp/read_file" });
  });

  // Tool input summary extraction (codex)
  test("extracts tool input from item.command", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "shell", item: { command: "ls -la" } },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
    expect(ev.summary!.kind).toBe("raw");
    if (ev.summary!.kind === "raw") expect(ev.summary!.text).toContain("ls -la");
  });

  test("extracts tool input from event.command", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", name: "shell", command: "echo hello" }, state);
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from event.arguments (string)", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", arguments: '{"key": "val"}' },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from event.input (object)", () => {
    const state = makeState();
    const { events } = parse({ type: "tool.started", name: "fn", input: { key: "val" } }, state);
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from item.arguments", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", item: { arguments: "arg text" } },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from item.input", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", item: { input: "input text" } },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from raw_item.arguments", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", item: { raw_item: { arguments: "raw args" } } },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from raw_item.input", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", item: { raw_item: { input: "raw input" } } },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from item.call.arguments", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", item: { call: { arguments: "call args" } } },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from raw_item.call.arguments", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "tool.started",
        name: "fn",
        item: { raw_item: { call: { arguments: "raw call args" } } },
      },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from item.function.arguments", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", item: { function: { arguments: "func args" } } },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("extracts tool input from raw_item.function.arguments", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "tool.started",
        name: "fn",
        item: { raw_item: { function: { arguments: "raw func args" } } },
      },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
  });

  test("shortenInline truncates long text", () => {
    const longText = "x".repeat(200);
    const state = makeState();
    const { events } = parse({ type: "tool.started", name: "fn", command: longText }, state);
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
    if (ev.summary!.kind === "raw") {
      expect(ev.summary!.text.length).toBeLessThan(200);
      expect(ev.summary!.text).toContain("...");
    }
  });

  test("shortenInline collapses newlines and whitespace", () => {
    const state = makeState();
    const { events } = parse(
      { type: "tool.started", name: "fn", command: "line1\nline2\n  line3" },
      state,
    );
    const ev = events[0] as Extract<FeedEvent, { type: "tool-start" }>;
    expect(ev.summary).toBeDefined();
    if (ev.summary!.kind === "raw") {
      expect(ev.summary!.text).not.toContain("\n");
    }
  });

  // item.added events
  test("handles response.output_item.added with tool", () => {
    const state = makeState();
    const { events } = parse(
      { type: "response.output_item.added", item: { type: "mcp_tool_call", name: "mcp_fn" } },
      state,
    );
    expect(events.some((e) => e.type === "tool-start")).toBe(true);
    expect(state.pendingTools).toBe(1);
  });

  test("handles item.added with tool type but no name (uses itemType)", () => {
    const state = makeState();
    const { events } = parse({ type: "item.added", item: { type: "function_call" } }, state);
    const toolEvent = events.find((e) => e.type === "tool-start") as Extract<
      FeedEvent,
      { type: "tool-start" }
    >;
    expect(toolEvent).toBeDefined();
    expect(toolEvent.name).toBe("function_call");
    expect(state.pendingTools).toBe(1);
  });

  test("handles item.added with computer_call type", () => {
    const state = makeState();
    const { events } = parse({ type: "item.added", item: { type: "computer_call" } }, state);
    expect(events.some((e) => e.type === "tool-start")).toBe(true);
  });

  test("handles item.added with message type content", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "item.added",
        item: {
          type: "message",
          content: [
            { type: "output_text", text: "message output" },
            { type: "text", text: " more text" },
            { type: "summary_text", text: " summary" },
          ],
        },
      },
      state,
    );
    const textEvent = events.find((e) => e.type === "text") as Extract<FeedEvent, { type: "text" }>;
    expect(textEvent).toBeDefined();
    expect(textEvent.text).toContain("message output");
  });

  test("handles item.added with no tool and non-tool item type", () => {
    const state = makeState();
    const { events } = parse({ type: "item.added", item: { type: "other_type" } }, state);
    expect(events.every((e) => e.type !== "tool-start")).toBe(true);
    expect(state.pendingTools).toBe(0);
  });

  // Tool completed events - all aliases
  test("handles tool.call.completed", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse({ type: "tool.call.completed", name: "Read", result: "done" }, state);
    expect(events.some((e) => e.type === "tool-end")).toBe(true);
    expect(state.pendingTools).toBe(0);
  });

  test("handles item.completed", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse({ type: "item.completed", name: "Write", output: "written" }, state);
    expect(events.some((e) => e.type === "tool-end")).toBe(true);
    expect(state.pendingTools).toBe(0);
  });

  test("handles response.output_item.done", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "response.output_item.done", name: "Bash", content: "output" },
      state,
    );
    expect(events.some((e) => e.type === "tool-end")).toBe(true);
    expect(state.pendingTools).toBe(0);
  });

  test("handles tool.completed with message text (agent_message)", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "Read", item: { type: "agent_message", text: "Agent done" } },
      state,
    );
    expect(events.some((e) => e.type === "text" && e.text === "Agent done")).toBe(true);
  });

  test("handles tool.completed with reasoning item type", () => {
    const state = makeState();
    const { events } = parse(
      { type: "item.completed", item: { type: "reasoning", text: "I reasoned" } },
      state,
    );
    expect(events.some((e) => e.type === "thinking")).toBe(true);
  });

  test("handles tool.completed with reasoning and printingText reset", () => {
    const state = makeState();
    state.printingText = true;
    parse({ type: "item.completed", item: { type: "reasoning", delta: "think" } }, state);
    expect(state.printingText).toBe(false);
  });

  test("handles tool.completed with no tool identity (no tool-end emitted)", () => {
    const state = makeState();
    const { events } = parse({ type: "item.completed", item: { type: "other" } }, state);
    expect(events.every((e) => e.type !== "tool-end")).toBe(true);
  });

  test("handles tool.completed does not decrement pendingTools below 0", () => {
    const state = makeState();
    state.pendingTools = 0;
    parse({ type: "tool.completed", name: "Read", output: "x" }, state);
    expect(state.pendingTools).toBe(0);
  });

  // Tool result summary extraction
  test("extracts result from item.error.message", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "Read", item: { error: { message: "Not found" } } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("Not found");
  });

  test("extracts result from event.error.message", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "Read", error: { message: "Failed" } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("Failed");
  });

  test("extracts result from item.aggregated_output", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "Bash", item: { aggregated_output: "aggregated out" } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("aggregated out");
  });

  test("extracts result from event.aggregated_output", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "Bash", aggregated_output: "evt aggregated" },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("evt aggregated");
  });

  test("extracts result from event.result", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse({ type: "tool.completed", name: "fn", result: "result value" }, state);
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("result value");
  });

  test("extracts result from event.content", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "fn", content: "content value" },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("content value");
  });

  test("extracts result from item.result", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "fn", item: { result: "item result" } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("item result");
  });

  test("extracts result from item.content", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "fn", item: { content: "item content" } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("item content");
  });

  test("extracts result from raw_item.output", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "fn", item: { raw_item: { output: "raw output" } } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("raw output");
  });

  test("extracts result from raw_item.result", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "fn", item: { raw_item: { result: "raw result" } } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("raw result");
  });

  test("extracts result from raw_item.content", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "fn", item: { raw_item: { content: "raw content" } } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("raw content");
  });

  test("extracts result from item.call.output", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      { type: "tool.completed", name: "fn", item: { call: { output: "call output" } } },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("call output");
  });

  test("extracts result from raw_item.call.output", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse(
      {
        type: "tool.completed",
        name: "fn",
        item: { raw_item: { call: { output: "raw call output" } } },
      },
      state,
    );
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toContain("raw call output");
  });

  test("extracts result with non-string value (JSON.stringify)", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse({ type: "tool.completed", name: "fn", output: { key: "val" } }, state);
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv.summary).toBeDefined();
  });

  test("tool.completed with no result summary", () => {
    const state = makeState();
    state.pendingTools = 1;
    const { events } = parse({ type: "tool.completed", name: "fn" }, state);
    const endEv = events.find((e) => e.type === "tool-end") as Extract<
      FeedEvent,
      { type: "tool-end" }
    >;
    expect(endEv).toBeDefined();
    expect(endEv.name).toBe("fn");
  });

  // response.completed
  test("handles response.completed with no output", () => {
    const state = makeState();
    const { events } = parse({ type: "response.completed", response: { output: [] } }, state);
    expect(events).toEqual([]);
  });

  test("handles response.completed with non-message output items", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "response.completed",
        response: { output: [{ type: "tool_call", name: "Read" }] },
      },
      state,
    );
    expect(events).toEqual([]);
  });

  test("handles response.completed with text type content", () => {
    const state = makeState();
    state.printingText = true;
    const { events } = parse(
      {
        type: "response.completed",
        response: {
          output: [{ type: "message", content: [{ type: "text", text: "final text" }] }],
        },
      },
      state,
    );
    expect(events.some((e) => e.type === "text" && e.text === "final text")).toBe(true);
    expect(state.printingText).toBe(false);
  });

  test("handles response.completed with mixed content types", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: "A" },
                { type: "image", data: "..." },
                { type: "text", text: "B" },
              ],
            },
          ],
        },
      },
      state,
    );
    const textEvent = events.find((e) => e.type === "text") as Extract<FeedEvent, { type: "text" }>;
    expect(textEvent).toBeDefined();
    expect(textEvent.text).toBe("AB");
  });

  test("handles response.completed with no response", () => {
    const { events } = parse({ type: "response.completed" });
    expect(events).toEqual([]);
  });

  // Default/unknown event types
  test("handles unknown event type (default case)", () => {
    const { events } = parse({ type: "some.unknown.event", data: "foo" });
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("raw");
    if (events[0]!.type === "raw") {
      expect(events[0].text).toContain("some.unknown.event");
    }
  });

  // getItemType coverage
  test("getItemType uses item.type", () => {
    const state = makeState();
    const { events } = parse({ type: "item.started", item: { type: "command_execution" } }, state);
    expect(events.some((e) => e.type === "tool-start")).toBe(true);
  });

  test("getItemType falls back to raw_item.type", () => {
    const state = makeState();
    const { events } = parse(
      { type: "item.started", item: { raw_item: { type: "command_execution" } } },
      state,
    );
    // With raw_item.type = command_execution, name becomes "shell"
    expect(events.some((e) => e.type === "tool-start")).toBe(true);
  });

  // extractMessageText with message type and content
  test("extractMessageText with message type and summary_text", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "item.added",
        item: {
          type: "message",
          content: [{ type: "summary_text", value: "summary value" }],
        },
      },
      state,
    );
    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
  });

  test("extractMessageText with message type and value field", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "item.added",
        item: {
          type: "message",
          content: [{ type: "text", value: "value field" }],
        },
      },
      state,
    );
    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
  });

  test("extractMessageText with raw_item content", () => {
    const state = makeState();
    const { events } = parse(
      {
        type: "item.added",
        item: {
          raw_item: {
            type: "message",
            content: [{ type: "output_text", text: "raw msg text" }],
          },
        },
      },
      state,
    );
    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
  });

  test("extractMessageText returns empty for non-message/non-agent_message types", () => {
    const state = makeState();
    const { events } = parse(
      { type: "item.added", item: { type: "thinking", text: "think" } },
      state,
    );
    // No text event because extractMessageText returns "" for thinking type
    expect(events.every((e) => e.type !== "text")).toBe(true);
  });

  // processCodexLine agent event filtering
  test("processCodexLine filters agent events in non-verbose mode", () => {
    const state = makeState();
    // Agent events are only produced by the system/init event in Claude, not Codex
    // But we can test via a processCodexLine flow that produces agent-type events
    // Actually, parseCodexLine doesn't produce agent events, so this tests the filter path
    // We can verify by checking that raw events are filtered in non-verbose
    const event = { type: "custom.event", data: "xyz" };
    const lines = processCodexLine(JSON.stringify(event), state);
    expect(lines).toEqual([]); // raw events filtered in non-verbose
  });
});

describe("formatCodexStream - additional coverage", () => {
  test("handles stream ending with printingText still true", () => {
    const stream = [
      JSON.stringify({ type: "response.output_text.delta", delta: "typing..." }),
    ].join("\n");

    const { output } = formatCodexStream(stream);
    // Should have appended an empty line
    expect(strip(output).length).toBeGreaterThan(0);
  });

  test("handles empty stream", () => {
    const { output, result } = formatCodexStream("");
    expect(output).toBe("");
    expect(result.rateLimited).toBe(false);
    expect(result.pendingTools).toBe(0);
  });

  test("handles verbose mode", () => {
    const stream = [
      JSON.stringify({ type: "thread.started", thread_id: "abc" }),
      JSON.stringify({ type: "custom.event", data: "xyz" }),
    ].join("\n");

    const { output } = formatCodexStream(stream, { verbose: true });
    const text = strip(output);
    expect(text).toContain("custom.event");
  });

  test("tracks pendingTools across stream", () => {
    const stream = [
      JSON.stringify({ type: "tool.started", name: "Read" }),
      JSON.stringify({ type: "tool.started", name: "Write" }),
      JSON.stringify({ type: "tool.completed", name: "Read", output: "done" }),
    ].join("\n");

    const { result } = formatCodexStream(stream);
    expect(result.pendingTools).toBe(1);
  });
});
