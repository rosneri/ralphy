import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { FeedEvent } from "@ralphy/types";

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

const { createCodexAdapter, buildCodexArgs } = await import("../index");

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

describe("buildCodexArgs", () => {
  test("returns expected codex CLI args", () => {
    expect(buildCodexArgs()).toEqual([
      "exec",
      "--json",
      "--color",
      "never",
      "--dangerously-bypass-approvals-and-sandbox",
      "-",
    ]);
  });
});

describe("createCodexAdapter", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  test("streams events from stdout", async () => {
    setupMockProc([
      '{"type":"thread.started","thread_id":"codex12345678"}',
      '{"type":"turn.started"}',
      '{"type":"response.output_text.delta","delta":"Hello codex"}',
      '{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":30}}',
    ]);

    const events: FeedEvent[] = [];
    const result = await createCodexAdapter({
      model: "codex-test",
      prompt: "test",
      onFeedEvent: (e) => events.push(e),
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeNull();
    expect(result.sessionId).toBeNull();
    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.some((e) => e.type === "turn-start")).toBe(true);
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "turn-done")).toBe(true);

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cmd[0]).toBe("codex");
    expect(call.cmd).toContain("exec");
    expect(call.cmd).toContain("--json");
    expect(call.cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(call.stderr).toBe("pipe");
    expect(call.stdin).toBe("pipe");
    expect(call.stdout).toBe("pipe");
  });

  test("drains stderr", async () => {
    setupMockProc(
      ['{"type":"thread.started","thread_id":"stderr_test"}', '{"type":"turn.completed"}'],
      0,
      ['{"type":"error","message":"stderr warning"}'],
    );

    const events: FeedEvent[] = [];
    await createCodexAdapter({
      model: "codex-test",
      prompt: "test",
      onFeedEvent: (e) => events.push(e),
    });

    expect(events.some((e) => e.type === "error" && e.message === "stderr warning")).toBe(true);
  });

  test("forwards raw lines via onRawLine", async () => {
    setupMockProc([
      '{"type":"thread.started","thread_id":"raw_test"}',
      '{"type":"turn.completed"}',
    ]);

    const raw: string[] = [];
    await createCodexAdapter({
      model: "codex-test",
      prompt: "test",
      onFeedEvent: () => {},
      onRawLine: (l) => raw.push(l),
    });

    expect(raw.length).toBeGreaterThan(0);
  });

  test("stdin receives prompt and is closed", async () => {
    setupMockProc([
      '{"type":"thread.started","thread_id":"stdin_test"}',
      '{"type":"turn.completed"}',
    ]);

    await createCodexAdapter({
      model: "codex-test",
      prompt: "my prompt",
      onFeedEvent: () => {},
    });

    expect(mockProc.stdin.write).toHaveBeenCalledTimes(1);
    expect(mockProc.stdin.flush).toHaveBeenCalledTimes(1);
    expect(mockProc.stdin.end).toHaveBeenCalledTimes(1);
  });

  test("rate-limit text in stream sets rateLimited flag", async () => {
    setupMockProc(
      ['{"type":"thread.started","thread_id":"rl_test"}', '{"type":"turn.completed"}'],
      0,
      ['{"type":"error","message":"You have hit your limit"}'],
    );

    const result = await createCodexAdapter({
      model: "codex-test",
      prompt: "test",
      onFeedEvent: () => {},
    });

    expect(result.rateLimited).toBe(true);
  });

  test("abort signal kills the process and normalizes exit code", async () => {
    setupMockProc(
      ['{"type":"thread.started","thread_id":"abort_test"}', '{"type":"turn.completed"}'],
      143,
    );
    const controller = new AbortController();
    controller.abort();

    const result = await createCodexAdapter({
      model: "codex-test",
      prompt: "test",
      signal: controller.signal,
      onFeedEvent: () => {},
    });

    expect(mockProc.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  test("preserves non-zero exit code when not killed by us", async () => {
    setupMockProc(
      ['{"type":"thread.started","thread_id":"exit_test"}', '{"type":"turn.completed"}'],
      1,
    );

    const result = await createCodexAdapter({
      model: "codex-test",
      prompt: "test",
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(1);
  });

  test("passes cwd to spawn when provided", async () => {
    setupMockProc([
      '{"type":"thread.started","thread_id":"cwd_test"}',
      '{"type":"turn.completed"}',
    ]);

    await createCodexAdapter({
      model: "codex-test",
      prompt: "test",
      cwd: "/some/dir",
      onFeedEvent: () => {},
    });

    const call = spawnMock.mock.calls[0]![0];
    expect(call.cwd).toBe("/some/dir");
  });
});
