import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
mock.module("@ralphy/adapter-codex/spawn", () => ({ spawn: spawnMock }));

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

  test("getAgent throws for unknown engine name", () => {
    // @ts-expect-error — testing runtime behavior for invalid engine name
    expect(() => getAgent("nope")).toThrow("Unknown agent");
    try {
      // @ts-expect-error — testing runtime behavior for invalid engine name
      getAgent("missing");
    } catch (err) {
      expect((err as Error & { agent?: string }).agent).toBe("missing");
    }
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

  test("spawns claude with a scrubbed env that omits CLAUDECODE", async () => {
    setupProc([INIT, RESULT]);
    const original = process.env["CLAUDECODE"];
    process.env["CLAUDECODE"] = "1";
    try {
      await claudeAgent.run({
        model: "claude-test",
        prompt: "go",
        onFeedEvent: () => {},
      });
    } finally {
      if (original === undefined) delete process.env["CLAUDECODE"];
      else process.env["CLAUDECODE"] = original;
    }
    const call = spawnMock.mock.calls[0]![0] as {
      env?: Record<string, string | undefined>;
    };
    expect(call.env).toBeDefined();
    expect(call.env!["CLAUDECODE"]).toBeUndefined();
  });

  test("passes --resume when resumeSessionId provided", async () => {
    setupProc([INIT, RESULT]);

    await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      resumeSessionId: "prev-session",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd).toContain("--resume");
    expect(call.cmd).toContain("prev-session");
  });

  test("skips --resume when reviewerContextStrategy is 'fresh'", async () => {
    setupProc([INIT, RESULT]);

    await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      resumeSessionId: "prev-session",
      reviewerContextStrategy: "fresh",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd).not.toContain("--resume");
    expect(call.cmd).not.toContain("prev-session");
  });

  test("passes --resume when reviewerContextStrategy is 'warm'", async () => {
    setupProc([INIT, RESULT]);

    await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      resumeSessionId: "prev-session",
      reviewerContextStrategy: "warm",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd).toContain("--resume");
    expect(call.cmd).toContain("prev-session");
  });

  test("uses reviewerModel when provided", async () => {
    setupProc([INIT, RESULT]);

    await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      reviewerModel: "claude-reviewer-model",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd).toContain("claude-reviewer-model");
    expect(call.cmd).not.toContain("claude-test");
  });

  test("falls back to base model when reviewerModel is not set", async () => {
    setupProc([INIT, RESULT]);

    await claudeAgent.run({
      model: "claude-base",
      prompt: "go",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd).toContain("claude-base");
  });

  test("kills immediately when signal is already aborted (SIGTERM exit normalized to 0)", async () => {
    setupProc([INIT, RESULT], 143);
    const controller = new AbortController();
    controller.abort();

    const result = await claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      onFeedEvent: () => {},
      signal: controller.signal,
    });

    expect(mockProc.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  test("kills when signal aborts mid-run via addEventListener", async () => {
    setupProc([INIT], 137);
    const controller = new AbortController();

    const runPromise = claudeAgent.run({
      model: "claude-test",
      prompt: "go",
      onFeedEvent: () => {},
      signal: controller.signal,
    });

    controller.abort();
    const result = await runPromise;

    expect(mockProc.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });
});

describe("claudeAgent.run (interactive)", () => {
  let taskDir: string;

  beforeEach(() => {
    spawnMock.mockClear();
    taskDir = mkdtempSync(join(tmpdir(), "engine-interactive-test-"));
  });

  afterEach(() => {
    rmSync(taskDir, { recursive: true, force: true });
  });

  function setupInteractiveMock(exitCode = 0) {
    mockProc = {
      stdin: {
        write: mock(() => {}),
        flush: mock(() => Promise.resolve()),
        end: mock(() => {}),
      },
      stdout: makeStream([]),
      stderr: makeStream([]),
      exited: Promise.resolve(exitCode),
      kill: mock(() => {}),
    };
  }

  test("spawns claude with inherited stdio", async () => {
    setupInteractiveMock(0);

    const result = await claudeAgent.run({
      model: "test-model",
      prompt: "interactive prompt",
      interactive: true,
      taskDir,
      onFeedEvent: () => {},
    });

    expect(result.usage).toBeNull();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd[0]).toBe("claude");
    expect(call.cmd).toContain("--model");
    expect(call.cmd).toContain("test-model");
    expect(call.cmd).toContain("--dangerously-skip-permissions");
    expect(call.stdin).toBe("inherit");
    expect(call.stdout).toBe("inherit");
    expect(call.stderr).toBe("inherit");
  });

  test("writes prompt to taskDir and cleans up", async () => {
    setupInteractiveMock(0);

    await claudeAgent.run({
      model: "test",
      prompt: "my interactive prompt",
      interactive: true,
      taskDir,
      onFeedEvent: () => {},
    });

    expect(existsSync(join(taskDir, "_interactive_prompt.md"))).toBe(false);
  });

  test("returns exitCode 0 when _interactive_done file exists", async () => {
    setupInteractiveMock(1);
    writeFileSync(join(taskDir, "_interactive_done"), "");

    const result = await claudeAgent.run({
      model: "test",
      prompt: "test",
      interactive: true,
      taskDir,
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeNull();
  });

  test("returns actual exitCode when no _interactive_done file", async () => {
    setupInteractiveMock(1);

    const result = await claudeAgent.run({
      model: "test",
      prompt: "test",
      interactive: true,
      taskDir,
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(1);
  });

  test("creates temp dir when no taskDir provided", async () => {
    setupInteractiveMock(0);

    const result = await claudeAgent.run({
      model: "test",
      prompt: "test",
      interactive: true,
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeNull();
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

  test("kills immediately when signal is already aborted (SIGTERM exit normalized to 0)", async () => {
    setupProc(['{"type":"turn.started"}'], 143);
    const controller = new AbortController();
    controller.abort();

    const result = await codexAgent.run({
      model: "codex-test",
      prompt: "go",
      onFeedEvent: () => {},
      signal: controller.signal,
    });

    expect(mockProc.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  test("kills when signal aborts mid-run via addEventListener", async () => {
    setupProc(['{"type":"turn.started"}'], 137);
    const controller = new AbortController();

    const runPromise = codexAgent.run({
      model: "codex-test",
      prompt: "go",
      onFeedEvent: () => {},
      signal: controller.signal,
    });

    controller.abort();
    const result = await runPromise;

    expect(mockProc.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });
});
