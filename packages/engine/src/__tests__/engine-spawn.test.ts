import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FeedEvent } from "../feed-events";

// Adapter-internal tests for the spawn-based claude/codex adapters.
// Engine-level behavior (session capture, usage aggregation, rate-limit,
// abort/cancel, exit codes) is exercised against the scripted adapter in
// engine.test.ts — those tests do not touch Bun.spawn / Bun.spawnSync.

// ─── Mock spawn ──────────────────────────────────────────────────

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

function makeReadableStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
}

interface SpawnOptions {
  cmd: string[];
  stderr?: string;
  [key: string]: unknown;
}
const spawnMock = mock((_options: SpawnOptions): MockProc => mockProc);

mock.module("../spawn", () => ({
  spawn: spawnMock,
}));

// Import after mocking
const { handleEngineFailure, runEngine } = await import("../engine");

// ─── handleEngineFailure ─────────────────────────────────────────

describe("handleEngineFailure", () => {
  test("exit code 42 returns rate limit and shouldStop=true", () => {
    const r = handleEngineFailure(42);
    expect(r.message).toContain("Rate limited");
    expect(r.shouldStop).toBe(true);
  });

  test("exit code 130 returns interrupted and shouldStop=false", () => {
    const r = handleEngineFailure(130);
    expect(r.message).toContain("Interrupted");
    expect(r.shouldStop).toBe(false);
  });

  test("exit code 137 returns killed and shouldStop=false", () => {
    const r = handleEngineFailure(137);
    expect(r.message).toContain("Killed");
    expect(r.shouldStop).toBe(false);
  });

  test("exit code 1 returns general error", () => {
    const r = handleEngineFailure(1);
    expect(r.message).toContain("Failed (exit 1)");
    expect(r.shouldStop).toBe(false);
  });

  test("unknown exit code returns generic message", () => {
    const r = handleEngineFailure(99);
    expect(r.message).toContain("Failed (exit 99)");
    expect(r.shouldStop).toBe(false);
  });
});

// ─── runEngine ───────────────────────────────────────────────────

describe("runEngine", () => {
  const INIT =
    '{"type":"system","subtype":"init","model":"claude-test","session_id":"test12345678"}';
  const TEXT = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}';
  const RESULT =
    '{"type":"result","subtype":"success","total_cost_usd":0.01,"duration_ms":100,"num_turns":1,"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":0}}';

  function setupMockProc(stdoutLines: string[], exitCode = 0, stderrLines: string[] = []) {
    mockProc = {
      stdin: {
        write: mock(() => {}),
        flush: mock(() => Promise.resolve()),
        end: mock(() => {}),
      },
      stdout: makeReadableStream(stdoutLines),
      stderr: stderrLines.length > 0 ? makeReadableStream(stderrLines) : makeReadableStream([]),
      exited: Promise.resolve(exitCode),
      kill: mock(() => {}),
    };
  }

  beforeEach(() => {
    spawnMock.mockClear();
  });

  test("claude engine streams events and returns usage", async () => {
    setupMockProc([INIT, TEXT, RESULT]);

    const events: FeedEvent[] = [];
    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "test",
      onOutput: () => {},
      onFeedEvent: (e) => events.push(e),
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).not.toBeNull();
    expect(result.usage!.input_tokens).toBe(10);
    expect(result.usage!.output_tokens).toBe(20);
    expect(result.usage!.cost_usd).toBe(0.01);
    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.some((e) => e.type === "text" && e.text === "Hello")).toBe(true);
    expect(events.some((e) => e.type === "result")).toBe(true);

    // Verify spawn was called with claude args
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd[0]).toBe("claude");
    expect(call.cmd).toContain("--model");
    expect(call.cmd).toContain("claude-test");
    expect(call.cmd).toContain("--output-format");
    expect(call.cmd).toContain("stream-json");
    expect(call.cmd).toContain("--verbose");
    expect(call.cmd).toContain("-p");
    expect(call.cmd).toContain("-");
    expect(call.cmd).toContain("--dangerously-skip-permissions");
  });

  test("claude engine without onFeedEvent falls back to renderFeedEvent", async () => {
    setupMockProc([INIT, RESULT]);

    const outputLines: string[] = [];
    const result = await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onOutput: (line) => outputLines.push(line),
    });

    expect(result.exitCode).toBe(0);
    expect(outputLines.length).toBeGreaterThan(0);
  });

  test("claude engine uses default onOutput (stdout) when none provided", async () => {
    setupMockProc([RESULT]);

    const result = await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(0);
  });

  test("codex engine streams events", async () => {
    setupMockProc([
      '{"type":"thread.started","thread_id":"codex12345678"}',
      '{"type":"turn.started"}',
      '{"type":"response.output_text.delta","delta":"Hello codex"}',
      '{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":30}}',
    ]);

    const events: FeedEvent[] = [];
    const result = await runEngine({
      engine: "codex",
      model: "codex-test",
      prompt: "test",
      onFeedEvent: (e) => events.push(e),
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeNull();
    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.some((e) => e.type === "turn-start")).toBe(true);
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "turn-done")).toBe(true);

    // Verify spawn with codex args
    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd[0]).toBe("codex");
    expect(call.cmd).toContain("exec");
    expect(call.cmd).toContain("--json");
    expect(call.cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  test("codex engine drains stderr", async () => {
    setupMockProc(
      ['{"type":"thread.started","thread_id":"stderr_test"}', '{"type":"turn.completed"}'],
      0,
      ['{"type":"error","message":"stderr warning"}'],
    );

    const events: FeedEvent[] = [];
    await runEngine({
      engine: "codex",
      model: "codex-test",
      prompt: "test",
      onFeedEvent: (e) => events.push(e),
    });

    expect(events.some((e) => e.type === "error" && e.message === "stderr warning")).toBe(true);
  });

  test("codex engine without onFeedEvent uses renderFeedEvent", async () => {
    setupMockProc([
      '{"type":"thread.started","thread_id":"nofeed_test"}',
      '{"type":"turn.completed"}',
    ]);

    const outputLines: string[] = [];
    await runEngine({
      engine: "codex",
      model: "codex-test",
      prompt: "test",
      onOutput: (line) => outputLines.push(line),
    });

    expect(outputLines.length).toBeGreaterThan(0);
  });

  test("handles non-zero exit code", async () => {
    setupMockProc([INIT], 1);

    const result = await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(1);
  });

  test("handles empty and invalid JSON lines", async () => {
    setupMockProc(["", INIT, "", "not json", RESULT]);

    const events: FeedEvent[] = [];
    await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onFeedEvent: (e) => events.push(e),
    });

    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.some((e) => e.type === "result")).toBe(true);
  });

  test("streams multiple text events", async () => {
    const t1 = '{"type":"assistant","message":{"content":[{"type":"text","text":"line1"}]}}';
    const t2 = '{"type":"assistant","message":{"content":[{"type":"text","text":"line2"}]}}';
    setupMockProc([INIT, t1, t2, RESULT]);

    const events: FeedEvent[] = [];
    await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onFeedEvent: (e) => events.push(e),
    });

    expect(events.filter((e) => e.type === "text").length).toBe(2);
  });

  test("stdin receives prompt and is properly closed", async () => {
    setupMockProc([RESULT]);

    await runEngine({
      engine: "claude",
      model: "test",
      prompt: "my prompt",
      onFeedEvent: () => {},
    });

    expect(mockProc.stdin.write).toHaveBeenCalledTimes(1);
    expect(mockProc.stdin.flush).toHaveBeenCalledTimes(1);
    expect(mockProc.stdin.end).toHaveBeenCalledTimes(1);
  });

  test("claude stderr is inherited, stdin/stdout piped", async () => {
    setupMockProc([RESULT]);

    await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.stderr).toBe("inherit");
    expect(call.stdin).toBe("pipe");
    expect(call.stdout).toBe("pipe");
  });

  test("codex stderr is piped", async () => {
    setupMockProc([
      '{"type":"thread.started","thread_id":"pipe_test"}',
      '{"type":"turn.completed"}',
    ]);

    await runEngine({
      engine: "codex",
      model: "test",
      prompt: "test",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.stderr).toBe("pipe");
  });

  test("passes --resume flag when resumeSessionId is provided", async () => {
    setupMockProc([INIT, RESULT]);

    await runEngine({
      engine: "claude",
      model: "test",
      prompt: "resumed prompt",
      resumeSessionId: "sess-abc123",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd).toContain("--resume");
    expect(call.cmd).toContain("sess-abc123");
  });

  test("captures sessionId from init event", async () => {
    setupMockProc([INIT, RESULT]);

    const result = await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onFeedEvent: () => {},
    });

    expect(result.sessionId).toBe("test12345678");
  });

  test("abort signal kills the process and normalizes exit code", async () => {
    setupMockProc([INIT, RESULT], 143);
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    const result = await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      signal: controller.signal,
      onFeedEvent: () => {},
    });

    expect(mockProc.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0); // normalized from 143
  });

  test("abort signal during execution kills process", async () => {
    setupMockProc([INIT, RESULT], 143);
    const controller = new AbortController();

    const resultPromise = runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      signal: controller.signal,
      onFeedEvent: () => {},
    });

    // Abort after engine starts
    controller.abort();
    const result = await resultPromise;

    expect(mockProc.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  // ─── interactive mode ────────────────────────────────────────────

  describe("interactive mode", () => {
    let taskDir: string;

    beforeEach(() => {
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
        stdout: makeReadableStream([]),
        stderr: makeReadableStream([]),
        exited: Promise.resolve(exitCode),
        kill: mock(() => {}),
      };
    }

    test("spawns claude with inherited stdio", async () => {
      setupInteractiveMock(0);

      const result = await runEngine({
        engine: "claude",
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

      await runEngine({
        engine: "claude",
        model: "test",
        prompt: "my interactive prompt",
        interactive: true,
        taskDir,
        onFeedEvent: () => {},
      });

      // Prompt file should be cleaned up after completion
      expect(existsSync(join(taskDir, "_interactive_prompt.md"))).toBe(false);
    });

    test("returns exitCode 0 when _interactive_done file exists", async () => {
      setupInteractiveMock(1);
      // Simulate the MCP tool having written the done file
      writeFileSync(join(taskDir, "_interactive_done"), "");

      const result = await runEngine({
        engine: "claude",
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

      const result = await runEngine({
        engine: "claude",
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

      const result = await runEngine({
        engine: "claude",
        model: "test",
        prompt: "test",
        interactive: true,
        onFeedEvent: () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.usage).toBeNull();
    });
  });

  test("streamLines handles trailing buffer without newline", async () => {
    // Simulate a stream that sends data without trailing newline
    const encoder = new TextEncoder();
    const customStdout = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(INIT + "\n" + RESULT));
        controller.close();
      },
    });

    mockProc = {
      stdin: {
        write: mock(() => {}),
        flush: mock(() => Promise.resolve()),
        end: mock(() => {}),
      },
      stdout: customStdout,
      stderr: makeReadableStream([]),
      exited: Promise.resolve(0),
      kill: mock(() => {}),
    };

    const events: FeedEvent[] = [];
    await runEngine({
      engine: "claude",
      model: "test",
      prompt: "test",
      onFeedEvent: (e) => events.push(e),
    });

    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.some((e) => e.type === "result")).toBe(true);
  });
});
