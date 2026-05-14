import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { FeedLine } from "../components/FeedLine";
import type { FeedEvent } from "@ralphy/engine/feed-events";

describe("FeedLine", () => {
  test("renders session event", () => {
    const event: FeedEvent = { type: "session", model: "opus", sessionId: "abc123" };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("opus");
    expect(frame).toContain("abc123");
  });

  test("renders session-unknown event", () => {
    const event: FeedEvent = { type: "session-unknown", sessionId: "xyz789" };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("UNKNOWN");
    expect(frame).toContain("xyz789");
    expect(frame).toContain("--log");
  });

  test("renders agent event", () => {
    const event: FeedEvent = { type: "agent", description: "reading files" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("reading files");
  });

  test("renders thinking event with preview", () => {
    const event: FeedEvent = { type: "thinking", preview: "Let me think about this\nSecond line" };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Let me think about this");
  });

  test("renders thinking event without preview", () => {
    const event: FeedEvent = { type: "thinking" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toBeDefined();
  });

  test("renders text event", () => {
    const event: FeedEvent = { type: "text", text: "Hello world" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("Hello world");
  });

  test("renders tool-start event without summary", () => {
    const event: FeedEvent = { type: "tool-start", name: "Read" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("Read");
  });

  test("renders tool-start event with file summary", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Read",
      summary: { kind: "file", name: "package.json" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Read");
    expect(frame).toContain("package.json");
  });

  test("renders tool-start event with command summary", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Bash",
      summary: { kind: "command", text: "npm install" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("npm install");
  });

  test("renders tool-start event with search summary (with path)", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Grep",
      summary: { kind: "search", pattern: "TODO", path: "src/" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("TODO");
    expect(frame).toContain("in src/");
  });

  test("renders tool-start event with search summary (without path)", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Grep",
      summary: { kind: "search", pattern: "TODO" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("TODO");
  });

  test("renders tool-start event with url summary", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Fetch",
      summary: { kind: "url", url: "https://example.com" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("https://example.com");
  });

  test("renders tool-start event with prompt summary", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Agent",
      summary: { kind: "prompt", text: "analyze this" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("analyze this");
  });

  test("renders tool-start event with edit summary", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Edit",
      summary: { kind: "edit" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Edit");
    expect(frame).toContain("edit");
  });

  test("renders tool-start event with write summary", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Write",
      summary: { kind: "write" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Write");
    expect(frame).toContain("write");
  });

  test("renders tool-start event with raw summary", () => {
    const event: FeedEvent = {
      type: "tool-start",
      name: "Custom",
      summary: { kind: "raw", text: "raw input data" },
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("raw input data");
  });

  test("renders tool-end event as empty", () => {
    const event: FeedEvent = { type: "tool-end", name: "Read", summary: "200 lines" };
    const { lastFrame } = render(<FeedLine event={event} />);
    // tool-end events are suppressed
    expect(lastFrame()!).toBe("");
  });

  test("renders tool-end event without name as empty", () => {
    const event: FeedEvent = { type: "tool-end" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toBe("");
  });

  test("renders tool-result-preview when verbose", () => {
    const event: FeedEvent = {
      type: "tool-result-preview",
      lines: ["line 1", "line 2"],
      truncated: 10,
    };
    const { lastFrame } = render(<FeedLine event={event} verbose />);
    const frame = lastFrame()!;
    expect(frame).toContain("line 1");
    expect(frame).toContain("line 2");
    expect(frame).toContain("10 more lines");
  });

  test("renders tool-result-preview without truncation", () => {
    const event: FeedEvent = {
      type: "tool-result-preview",
      lines: ["only line"],
    };
    const { lastFrame } = render(<FeedLine event={event} verbose />);
    const frame = lastFrame()!;
    expect(frame).toContain("only line");
  });

  test("returns null for tool-result-preview when not verbose", () => {
    const event: FeedEvent = {
      type: "tool-result-preview",
      lines: ["line 1"],
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toBe("");
  });

  test("renders turn-start event", () => {
    const event: FeedEvent = { type: "turn-start" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("turn started");
  });

  test("renders turn-done event with token counts", () => {
    const event: FeedEvent = { type: "turn-done", inputTokens: 1000, outputTokens: 500 };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("done");
    expect(frame).toContain("in=1000");
    expect(frame).toContain("out=500");
  });

  test("renders turn-done event without token counts", () => {
    const event: FeedEvent = { type: "turn-done" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("done");
  });

  test("renders turn-done event with zero outputTokens", () => {
    const event: FeedEvent = { type: "turn-done", inputTokens: 100 };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("in=100");
    expect(frame).toContain("out=0");
  });

  test("renders result event", () => {
    const event: FeedEvent = {
      type: "result",
      cost: 0.1234,
      timeMs: 5500,
      turns: 3,
      inputTokens: 1000,
      outputTokens: 500,
      cached: 200,
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("done");
    expect(frame).toContain("$0.12");
    expect(frame).toContain("5.5s");
    expect(frame).toContain("turns=3");
    expect(frame).toContain("in=1000");
    expect(frame).toContain("out=500");
    expect(frame).toContain("cached=200");
  });

  test("renders result-error event", () => {
    const event: FeedEvent = { type: "result-error", message: "Something went wrong" };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Error");
    expect(frame).toContain("Something went wrong");
  });

  test("renders error event", () => {
    const event: FeedEvent = { type: "error", message: "Connection failed" };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("error");
    expect(frame).toContain("Connection failed");
  });

  test("renders rate-limit event", () => {
    const event: FeedEvent = { type: "rate-limit", message: "Too many requests" };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Rate limit");
    expect(frame).toContain("Too many requests");
  });

  test("renders interrupted event", () => {
    const event: FeedEvent = { type: "interrupted", turns: 5, tools: 3 };
    const { lastFrame } = render(<FeedLine event={event} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Stream interrupted");
    expect(frame).toContain("turns=5");
    expect(frame).toContain("tools=3");
  });

  test("renders raw event", () => {
    const event: FeedEvent = { type: "raw", text: "raw output text" };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("raw output text");
  });

  test("formatCost rounds correctly", () => {
    const event: FeedEvent = {
      type: "result",
      cost: 1.999,
      timeMs: 1000,
      turns: 1,
      inputTokens: 100,
      outputTokens: 50,
      cached: 0,
    };
    const { lastFrame } = render(<FeedLine event={event} />);
    expect(lastFrame()!).toContain("$2.00");
  });
});
