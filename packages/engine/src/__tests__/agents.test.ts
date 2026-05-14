import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { FeedEvent } from "../feed-events";

// ─── Shared mock spawn ────────────────────────────────────────────

interface MockProc {
  stdin: {
    write: ReturnType<typeof mock>;
    flush: ReturnType<typeof mock>;
    end: ReturnType<typeof mock>;
  };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: ReturnType<typeof mock>;
}

let mockProc: MockProc;

function makeStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
}

interface SpawnOptions {
  cmd: string[];
  [key: string]: unknown;
}
const spawnMock = mock((_options: SpawnOptions): MockProc => mockProc);

mock.module("../spawn", () => ({ spawn: spawnMock }));

const { AGENTS, getAgent } = await import("../agents");
const claudeAgent = getAgent("claude");
const codexAgent = getAgent("codex");

function setupProc(stdoutLines: string[], exitCode = 0, stderrLines: string[] = []) {
  mockProc = {
    stdin: {
      write: mock(() => {}),
      flush: mock(() => Promise.resolve()),
      end: mock(() => {}),
    },
    stdout: makeStream(stdoutLines),
    stderr: makeStream(stderrLines),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

// ─── Registry ─────────────────────────────────────────────────────

describe("agent registry", () => {
  test("exposes claude and codex by name", () => {
    expect(claudeAgent.name).toBe("claude");
    expect(codexAgent.name).toBe("codex");
  });

  test("getAgent returns the same instance from the registry", () => {
    expect(getAgent("claude")).toBe(claudeAgent);
    expect(getAgent("codex")).toBe(codexAgent);
    expect(AGENTS).toHaveProperty("claude");
    expect(AGENTS).toHaveProperty("codex");
  });
});

// ─── Adapter contract: each adapter implements the same protocol ──

describe("claudeAgent.run", () => {
  const INIT =
    '{"type":"system","subtype":"init","model":"claude-test","session_id":"sess-abc12345"}';
  const TEXT = '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}';
  const RESULT =
    '{"type":"result","subtype":"success","total_cost_usd":0.02,"duration_ms":200,"num_turns":2,"usage":{"input_tokens":11,"output_tokens":22}}';

  beforeEach(() => {
    spawnMock.mockClear();
  });

  test("returns AgentRunResult with usage and sessionId", async () => {
    setupProc([INIT, TEXT, RESULT]);

    const events: FeedEvent[] = [];
    const result = await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      onFeedEvent: (e) => events.push(e),
    });

    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe("sess-abc12345");
    expect(result.usage?.input_tokens).toBe(11);
    expect(result.rateLimited).toBe(false);
    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.some((e) => e.type === "result")).toBe(true);
  });

  test("forwards onRawLine for every line of stdout", async () => {
    setupProc([INIT, RESULT]);

    const raw: string[] = [];
    await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      onFeedEvent: () => {},
      onRawLine: (l) => raw.push(l),
    });

    expect(raw).toContain(INIT);
    expect(raw).toContain(RESULT);
  });

  test("detects rate-limit text in feed events", async () => {
    const RATE =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"You\'ve hit your limit"}]}}';
    setupProc([INIT, RATE, RESULT]);

    const result = await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      onFeedEvent: () => {},
    });

    expect(result.rateLimited).toBe(true);
  });
});

describe("codexAgent.run", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  test("returns AgentRunResult and emits feed events", async () => {
    setupProc([
      '{"type":"thread.started","thread_id":"codex-thread-1"}',
      '{"type":"turn.started"}',
      '{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":3}}',
    ]);

    const events: FeedEvent[] = [];
    const result = await codexAgent.run({
      model: "codex-test",
      prompt: "go",
      onFeedEvent: (e) => events.push(e),
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeNull();
    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.some((e) => e.type === "turn-done")).toBe(true);
  });

  test("propagates rate limit detected in codex stream", async () => {
    setupProc(['{"type":"error","message":"You\'ve hit your limit on usage"}']);

    const result = await codexAgent.run({
      model: "codex-test",
      prompt: "go",
      onFeedEvent: () => {},
    });

    expect(result.rateLimited).toBe(true);
  });
});
