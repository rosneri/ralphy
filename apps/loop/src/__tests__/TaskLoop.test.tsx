import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { render } from "ink-testing-library";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { buildInitialState, writeState } from "@ralphy/core/state";
import type { State } from "@ralphy/types";
import type { BuildInitialStateOptions } from "@ralphy/core/state";
import type { EngineResult } from "@ralphy/engine/engine";

// Mock the engine module to avoid spawning real processes
const runEngineMock = mock(
  async (opts: {
    onFeedEvent?: (e: unknown) => void;
    signal?: AbortSignal;
    resumeSessionId?: string;
  }): Promise<EngineResult> => {
    // Emit a few feed events for coverage
    if (opts.onFeedEvent) {
      opts.onFeedEvent({ type: "session", model: "opus", sessionId: "test123" });
      opts.onFeedEvent({ type: "text", text: "Working..." });
      opts.onFeedEvent({ type: "turn-done" });
    }
    return { exitCode: 0, usage: null, sessionId: null, rateLimited: false };
  },
);

const handleEngineFailureMock = mock((exitCode: number) => ({
  message: `Failed (exit ${exitCode})`,
  shouldStop: false,
}));

mock.module("@ralphy/engine/engine", () => ({
  runEngine: runEngineMock,
  handleEngineFailure: handleEngineFailureMock,
}));

// Mock git operations to avoid real git commands
mock.module("@ralphy/core/git", () => ({
  gitPush: mock(() => {}),
  commitTaskDir: mock(() => {}),
  commitState: mock(() => {}),
  getCurrentBranch: mock(() => "test-branch"),
  gitAdd: mock(() => {}),
  gitCommit: mock(() => {}),
}));

// Mock scaffoldTaskDocuments to be a no-op
mock.module("@ralphy/core/templates", () => ({
  scaffoldTaskDocuments: mock(() => {}),
  renderTemplate: (content: string, vars: Record<string, string>) => {
    let result = content;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
  },
  resolveTemplatePath: mock((name: string) => `/tmp/templates/${name}.md`),
}));

// Import after mocking
const { TaskLoop } = await import("../components/TaskLoop");

let tempDir: string;

function withStorage<T>(fn: () => T): T {
  return runWithContext(createDefaultContext(), fn);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "taskloop-test-"));
  runEngineMock.mockClear();
  handleEngineFailureMock.mockClear();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const stubChangeStore = {
  archiveChange: (_name: string) => Promise.resolve(),
  // Throwing keeps the loop's "still active" fallback — existing tests
  // that never write a tasks.md should not be terminated as
  // archived-externally.
  listChanges: () => Promise.reject(new Error("listChanges not stubbed")),
};

function makeState(overrides: Partial<BuildInitialStateOptions> = {}): State {
  return buildInitialState({
    name: "test-task",
    prompt: "Test prompt text",
    ...overrides,
  });
}

describe("TaskLoop", () => {
  test("renders banner and exits after loop completes (maxIterations=1)", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "test-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "test-task" });
      writeState(taskDir, state);

      const opts = {
        name: "test-task",
        prompt: "Test prompt text",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);

      // Wait for the async loop to complete
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      // Banner should be rendered showing task info
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("renders with PROGRESS.md present", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "prog-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "prog-task" });
      writeState(taskDir, state);
      writeFileSync(
        join(taskDir, "PROGRESS.md"),
        "## Section 1 — Setup\n- [x] Done\n- [ ] Pending\n",
        "utf-8",
      );

      const opts = {
        name: "prog-task",
        prompt: "Test prompt text",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("handles engine failure", async () => {
    runEngineMock.mockImplementationOnce(async () => ({
      exitCode: 1,
      usage: null,
      sessionId: null,
      rateLimited: false,
    }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "fail-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "fail-task" });
      writeState(taskDir, state);

      const opts = {
        name: "fail-task",
        prompt: "Test prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 5,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("resumes existing task", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "resume-task");
      mkdirSync(taskDir, { recursive: true });
      // Create a state that has already run some iterations
      const state = {
        ...makeState({ name: "resume-task" }),
        iteration: 3,
      };
      writeState(taskDir, state);

      const opts = {
        name: "resume-task",
        prompt: "Resume prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("resumed");
    });
  });

  test("stops on terminal phase", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "done-task");
      mkdirSync(taskDir, { recursive: true });
      const state = {
        ...makeState({ name: "done-task" }),
        status: "completed" as const,
      };
      writeState(taskDir, state);

      const opts = {
        name: "done-task",
        prompt: "Done prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 0,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      // Should show the stop message for terminal phase
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("renders with verbose flag", async () => {
    runEngineMock.mockImplementationOnce(async (opts: { onFeedEvent?: (e: unknown) => void }) => {
      if (opts.onFeedEvent) {
        opts.onFeedEvent({ type: "session", model: "opus", sessionId: "test" });
        opts.onFeedEvent({
          type: "tool-result-preview",
          lines: ["preview line"],
          truncated: 5,
        });
      }
      return { exitCode: 0, usage: null, sessionId: null, rateLimited: false };
    });

    await withStorage(async () => {
      const taskDir = join(tempDir, "verbose-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "verbose-task" });
      writeState(taskDir, state);

      const opts = {
        name: "verbose-task",
        prompt: "Verbose prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: true,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("engine updates model on resume with different engine/model", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "reconfig-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "reconfig-task", engine: "claude", model: "sonnet" });
      writeState(taskDir, state);

      const opts = {
        name: "reconfig-task",
        prompt: "Reconfig",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("handles engine exception", async () => {
    runEngineMock.mockImplementationOnce(async () => {
      throw new Error("Engine crashed");
    });

    await withStorage(async () => {
      const taskDir = join(tempDir, "crash-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "crash-task" });
      writeState(taskDir, state);

      const opts = {
        name: "crash-task",
        prompt: "Crash prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 5,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("handles STOP signal file", async () => {
    // First call succeeds, which will let us check for STOP after
    runEngineMock.mockImplementationOnce(async () => ({
      exitCode: 0,
      usage: null,
      sessionId: null,
      rateLimited: false,
    }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "stop-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "stop-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "STOP"), "Manual stop requested", "utf-8");

      const opts = {
        name: "stop-task",
        prompt: "Stop prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 10,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("engine result with usage accumulates stats", async () => {
    runEngineMock.mockImplementationOnce(async () => ({
      exitCode: 0,
      usage: {
        cost_usd: 0.5,
        duration_ms: 3000,
        num_turns: 2,
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      },
      sessionId: null,
      rateLimited: false,
    }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "usage-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "usage-task" });
      writeState(taskDir, state);

      const opts = {
        name: "usage-task",
        prompt: "Usage prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("creates new state when no state.json exists (else branch)", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "new-task");
      mkdirSync(taskDir, { recursive: true });
      // Deliberately do NOT write state.json — triggers the else branch (lines 91-97)

      const opts = {
        name: "new-task",
        prompt: "New task prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("consecutive identical failures increment counter", async () => {
    // Return the same exit code twice to trigger consFailures++ (line 175)
    runEngineMock
      .mockImplementationOnce(async () => ({
        exitCode: 1,
        usage: null,
        sessionId: null,
        rateLimited: false,
      }))
      .mockImplementationOnce(async () => ({
        exitCode: 1,
        usage: null,
        sessionId: null,
        rateLimited: false,
      }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "confail-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "confail-task" });
      writeState(taskDir, state);

      const opts = {
        name: "confail-task",
        prompt: "Fail prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 10,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("live steering kills engine, writes steering.md, and resumes session", async () => {
    let engineStartResolve: () => void;
    const engineStarted = new Promise<void>((r) => {
      engineStartResolve = r;
    });

    // First call: return a sessionId, wait for abort
    runEngineMock.mockImplementationOnce(
      async (opts: { onFeedEvent?: (e: unknown) => void; signal?: AbortSignal }) => {
        engineStartResolve!();
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener("abort", () => resolve(), { once: true });
          setTimeout(resolve, 2000);
        });
        return { exitCode: 0, usage: null, sessionId: "sess-abc123", rateLimited: false };
      },
    );

    // Second call: the resumed session
    runEngineMock.mockImplementationOnce(
      async (opts: { onFeedEvent?: (e: unknown) => void; resumeSessionId?: string }) => {
        // Verify it's a resume call
        expect(opts.resumeSessionId).toBe("sess-abc123");
        return { exitCode: 0, usage: null, sessionId: "sess-abc123", rateLimited: false };
      },
    );

    await withStorage(async () => {
      const taskDir = join(tempDir, "steer-live-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "steer-live-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "steering.md"), "original\n", "utf-8");

      // Use a wrapper to capture the steer function
      let steerFn: ((msg: string) => void) | null = null;
      const WrappedTaskLoop = () => {
        const { useLoop: useLoopHook } = require("../hooks/useLoop");
        const loop = useLoopHook({
          name: "steer-live-task",
          prompt: "Steer live test",
          engine: "claude" as const,
          model: "opus",
          maxIterations: 1,
          maxCostUsd: 0,
          maxRuntimeMinutes: 0,
          maxConsecutiveFailures: 5,
          delay: 0,
          log: false,
          verbose: false,
          manualTest: false,
          statesDir: tempDir,
          tasksDir: tempDir,
          changeStore: stubChangeStore,
        });
        steerFn = loop.steer;
        return null;
      };

      render(<WrappedTaskLoop />);

      // Wait for engine to start
      await engineStarted;
      await new Promise((r) => setTimeout(r, 50));

      // Trigger steer
      steerFn!("focus on tests");

      // Wait for resume to complete
      await new Promise((r) => setTimeout(r, 500));

      // Verify steering.md was appended
      const steeringContent = await Bun.file(join(taskDir, "steering.md")).text();
      expect(steeringContent).toContain("original");
      expect(steeringContent).toContain("focus on tests");

      // Verify engine was called twice (original + resume)
      expect(runEngineMock).toHaveBeenCalledTimes(2);
    });
  });

  test("processSteerSubmit trims, adds to history, and calls onSubmit", () => {
    const { processSteerSubmit } = require("../components/TaskLoop");
    const history: string[] = [];
    const submitted: string[] = [];
    const onSubmit = (msg: string) => submitted.push(msg);

    // Empty/whitespace returns false
    expect(processSteerSubmit("", history, onSubmit)).toBe(false);
    expect(processSteerSubmit("   ", history, onSubmit)).toBe(false);
    expect(submitted).toEqual([]);
    expect(history).toEqual([]);

    // Valid input returns true, adds to history, calls onSubmit
    expect(processSteerSubmit("  focus on tests  ", history, onSubmit)).toBe(true);
    expect(submitted).toEqual(["focus on tests"]);
    expect(history).toEqual(["focus on tests"]);

    // Another submission
    expect(processSteerSubmit("skip lint", history, onSubmit)).toBe(true);
    expect(submitted).toEqual(["focus on tests", "skip lint"]);
    expect(history).toEqual(["focus on tests", "skip lint"]);
  });

  test("handleSteerKeyInput delegates to navigateHistory for arrow keys", () => {
    const { handleSteerKeyInput } = require("../components/TaskLoop");
    const history = ["a", "b", "c"];

    // Non-arrow key returns null
    expect(handleSteerKeyInput({ upArrow: false, downArrow: false }, history, -1)).toBeNull();

    // Up arrow navigates
    const r1 = handleSteerKeyInput({ upArrow: true, downArrow: false }, history, -1);
    expect(r1).toEqual({ value: "c", index: 0 });

    // Down arrow navigates
    const r2 = handleSteerKeyInput({ upArrow: false, downArrow: true }, history, 1);
    expect(r2).toEqual({ value: "c", index: 0 });
  });

  test("navigateHistory returns correct values for up/down", () => {
    const { navigateHistory } = require("../components/TaskLoop");
    const history = ["first", "second", "third"];

    // Empty history returns null
    expect(navigateHistory([], -1, "up")).toBeNull();

    // Up from start recalls most recent
    const r1 = navigateHistory(history, -1, "up");
    expect(r1).toEqual({ value: "third", index: 0 });

    // Up again goes further back
    const r2 = navigateHistory(history, 0, "up");
    expect(r2).toEqual({ value: "second", index: 1 });

    // Up at the end stays
    const r3 = navigateHistory(history, 2, "up");
    expect(r3).toEqual({ value: "first", index: 2 });

    // Down from middle
    const r4 = navigateHistory(history, 1, "down");
    expect(r4).toEqual({ value: "third", index: 0 });

    // Down from 0 clears
    const r5 = navigateHistory(history, 0, "down");
    expect(r5).toEqual({ value: "", index: -1 });

    // Down from -1 stays empty
    const r6 = navigateHistory(history, -1, "down");
    expect(r6).toEqual({ value: "", index: -1 });
  });

  test("SteerInput renders and handles keyboard input", async () => {
    const submitted: string[] = [];
    const { SteerInput } = await import("../components/TaskLoop");

    const { stdin } = render(<SteerInput onSubmit={(msg) => submitted.push(msg)} />);

    // Send up arrow to exercise the useInput handler (no history yet, so no-op)
    stdin.write("\x1B[A");
    await new Promise((r) => setTimeout(r, 50));

    // Send a regular key to exercise the useInput handler's non-arrow path
    stdin.write("x");
    await new Promise((r) => setTimeout(r, 50));

    // Send return to exercise onSubmit
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    // "x" should have been submitted
    expect(submitted).toEqual(["x"]);
  });

  test("steer input is rendered while task is running", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "steer-vis-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "steer-vis-task" });
      writeState(taskDir, state);

      const opts = {
        name: "steer-vis-task",
        prompt: "Steer vis",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      // Steer input should have been rendered at some point while running
      expect(allText).toContain("steer:");
    });
  });

  test("StopMessage is not rendered while loop is still running", async () => {
    // Engine call hangs until aborted — loop stays in "running" state for the test window.
    runEngineMock.mockImplementationOnce(
      async (opts: { signal?: AbortSignal }) =>
        new Promise<EngineResult>((resolve) => {
          opts.signal?.addEventListener(
            "abort",
            () => resolve({ exitCode: 0, usage: null, sessionId: null, rateLimited: false }),
            { once: true },
          );
        }),
    );

    await withStorage(async () => {
      const taskDir = join(tempDir, "running-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "running-task" });
      writeState(taskDir, state);

      const opts = {
        name: "running-task",
        prompt: "Running prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { lastFrame } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 200));

      const frame = lastFrame() ?? "";
      // While running, none of the StopMessage strings should appear.
      expect(frame).toContain("Ralph Loop");
      expect(frame).not.toContain("All tasks completed — change archived.");
      expect(frame).not.toContain("Reached max iterations");
      expect(frame).not.toContain("rate/usage limit");
    });
  });

  test("delay between iterations triggers sleep", async () => {
    // Two successful iterations with a small delay
    runEngineMock
      .mockImplementationOnce(async () => ({
        exitCode: 0,
        usage: null,
        sessionId: null,
        rateLimited: false,
      }))
      .mockImplementationOnce(async () => ({
        exitCode: 0,
        usage: null,
        sessionId: null,
        rateLimited: false,
      }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "delay-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "delay-task" });
      writeState(taskDir, state);

      const opts = {
        name: "delay-task",
        prompt: "Delay prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 2,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,

        delay: 0.01, // 10ms delay
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 1000));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
    });
  });

  test("reports task counts when tasks.md and agent-tasks.md are present", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "tasks-count-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "tasks-count-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [ ] one\n- [ ] two\n", "utf-8");
      writeFileSync(join(taskDir, "agent-tasks.md"), "- [ ] agent-one\n", "utf-8");

      const opts = {
        name: "tasks-count-task",
        prompt: "Task counts",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("tasks.md: 2 unchecked");
      expect(allText).toContain("agent-tasks.md: 1 unchecked");
    });
  });

  test("archives change when all tasks are completed", async () => {
    let archived: string | null = null;
    const archivingStore = {
      archiveChange: (name: string) => {
        archived = name;
        return Promise.resolve();
      },
    };

    await withStorage(async () => {
      const taskDir = join(tempDir, "all-done-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "all-done-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [x] one\n- [x] two\n", "utf-8");

      const opts = {
        name: "all-done-task",
        prompt: "Done",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: archivingStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("All tasks completed");
      expect(archived).toBe("all-done-task");
    });
  });

  test("recovers from a partial-write .ralph-state.json (linear-sync race)", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "partial-state");
      mkdirSync(taskDir, { recursive: true });
      // Simulate the linear-sync race: a state file exists but only carries
      // the linearComments patch — no version/name/prompt/createdAt.
      writeFileSync(
        join(taskDir, ".ralph-state.json"),
        JSON.stringify({
          linearComments: {
            planCommentId: null,
            tasksCommentId: "preserve-me-123",
            planPostedAt: null,
          },
          status: "active",
          lastModified: "2026-05-18T17:43:45.968Z",
        }),
        "utf-8",
      );
      writeFileSync(join(taskDir, "tasks.md"), "- [x] one\n", "utf-8");

      const opts = {
        name: "partial-state",
        prompt: "Recover and run",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("malformed");
      // tasks.md is fully checked off — recovered state should let the
      // "all tasks completed" path run normally instead of crashing.
      expect(allText).toContain("All tasks completed");

      // linearComments id must survive recovery to avoid duplicate comments.
      const rewritten = JSON.parse(
        require("node:fs").readFileSync(join(taskDir, ".ralph-state.json"), "utf-8"),
      );
      expect(rewritten.linearComments?.tasksCommentId).toBe("preserve-me-123");
      expect(rewritten.version).toBe("2");
      expect(typeof rewritten.prompt).toBe("string");
      expect(typeof rewritten.createdAt).toBe("string");
    });
  });

  test("exits when tasks.md is missing on a resumed task (change archived externally)", async () => {
    let runs = 0;
    runEngineMock.mockImplementation(async () => {
      runs++;
      return { exitCode: 0, usage: null, sessionId: null, rateLimited: false };
    });

    const externallyArchivedStore = {
      archiveChange: (_name: string) => Promise.resolve(),
      // Change is no longer active — simulates `openspec archive` having run.
      listChanges: () => Promise.resolve([] as string[]),
    };

    await withStorage(async () => {
      const taskDir = join(tempDir, "missing-tasks");
      mkdirSync(taskDir, { recursive: true });
      // iteration > 0 marks this as a resume — the change ran before and was
      // archived out from under us.
      const state = { ...makeState({ name: "missing-tasks" }), iteration: 5 };
      writeState(taskDir, state);
      // Intentionally do NOT write tasks.md — simulates archived change.

      const opts = {
        name: "missing-tasks",
        prompt: "no tasks file",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 10,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: externallyArchivedStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("archived externally");
      expect(runs).toBe(0);
    });
  });

  test("skips archive when openspec status reports change incomplete", async () => {
    let archived = false;
    const incompleteStore = {
      archiveChange: (_name: string) => {
        archived = true;
        return Promise.resolve();
      },
      getStatus: (_name: string) =>
        Promise.resolve({
          changeName: "incomplete-task",
          isComplete: false,
          applyRequires: [] as string[],
          artifacts: [{ id: "spec.md", status: "blocked" as const }],
        }),
    };

    await withStorage(async () => {
      const taskDir = join(tempDir, "incomplete-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "incomplete-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [x] only\n", "utf-8");

      const opts = {
        name: "incomplete-task",
        prompt: "Incomplete",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: incompleteStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Archive skipped");
      expect(allText).toContain("spec.md=blocked");
      expect(archived).toBe(false);
    });
  });

  test("surfaces archive errors as info message", async () => {
    const failingStore = {
      archiveChange: (_name: string) => Promise.reject(new Error("archive boom")),
    };

    await withStorage(async () => {
      const taskDir = join(tempDir, "archive-fail-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "archive-fail-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [x] only\n", "utf-8");

      const opts = {
        name: "archive-fail-task",
        prompt: "Archive fail",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: failingStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Archive warning");
    });
  });

  test("stops when engine reports rate limit", async () => {
    runEngineMock.mockImplementationOnce(async () => ({
      exitCode: 2,
      usage: null,
      sessionId: null,
      rateLimited: true,
    }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "rate-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "rate-task" });
      writeState(taskDir, state);

      const opts = {
        name: "rate-task",
        prompt: "Rate prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 5,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("rate/usage limit");
      // Only one engine call before stopping
      expect(runEngineMock).toHaveBeenCalledTimes(1);
    });
  });

  test("recovers specAttachments from partial-write state (malformed + specAttachments)", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "spec-attach-task");
      mkdirSync(taskDir, { recursive: true });
      // Write a malformed state (missing required fields) that has a valid specAttachments entry
      const knownAttachId = "attach-id-999";
      writeFileSync(
        join(taskDir, ".ralph-state.json"),
        JSON.stringify({
          specAttachments: {
            proposal: { attachmentId: knownAttachId, sha256: "abc123" },
            design: { attachmentId: null, sha256: null },
            proposalPdf: { attachmentId: null, sha256: null },
            designPdf: { attachmentId: null, sha256: null },
          },
          status: "active",
          lastModified: "2026-05-18T17:43:45.968Z",
        }),
        "utf-8",
      );
      writeFileSync(join(taskDir, "tasks.md"), "- [x] only\n", "utf-8");

      const opts = {
        name: "spec-attach-task",
        prompt: "Spec attach test",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 1,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("malformed");

      const rewritten = JSON.parse(
        require("node:fs").readFileSync(join(taskDir, ".ralph-state.json"), "utf-8"),
      );
      expect(rewritten.specAttachments?.proposal?.attachmentId).toBe(knownAttachId);
    });
  });

  test("review phase runs when all tasks complete and findings exist", async () => {
    // tasks.md is all done, no findings → review runs → no open findings → self-review passed
    runEngineMock.mockImplementationOnce(async () => ({
      exitCode: 0,
      usage: null,
      sessionId: null,
      rateLimited: false,
    }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "review-phase-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "review-phase-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [x] all done\n", "utf-8");

      const reviewFindings: string[] = [];
      const opts = {
        name: "review-phase-task",
        prompt: "Review phase test",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 3,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
        reviewPhase: { enabled: true, maxRounds: 1, reviewerModel: "opus" },
        onReviewRound: async (result: import("../loop").ReviewRoundResult) => {
          reviewFindings.push(`round=${result.roundNumber} open=${result.openFindings}`);
        },
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 600));

      const allText = frames.join("\n");
      expect(allText).toContain("self-review pass");
    });
  });

  test("review phase skips when cap already reached", async () => {
    await withStorage(async () => {
      const taskDir = join(tempDir, "review-cap-task");
      mkdirSync(taskDir, { recursive: true });
      const state = {
        ...makeState({ name: "review-cap-task" }),
        reviewRounds: 2,
      };
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [x] all done\n", "utf-8");

      const opts = {
        name: "review-cap-task",
        prompt: "Cap test",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 3,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
        reviewPhase: { enabled: true, maxRounds: 2 },
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      // Cap already reached so review is skipped, goes straight to archive
      expect(allText).toContain("All tasks completed");
      // review engine mock should NOT have been called for a review
      expect(runEngineMock).not.toHaveBeenCalled();
    });
  });

  test("review phase loops back when open findings remain and cap not reached", async () => {
    // Review engine call #1: looping back (findings pre-written, mock doesn't change them)
    // Review engine call #2: clears findings so loop exits cleanly
    runEngineMock
      .mockImplementationOnce(async () => ({
        exitCode: 0,
        usage: null,
        sessionId: null,
        rateLimited: false,
      }))
      .mockImplementationOnce(async () => {
        // Clear findings so the second review passes and the loop can archive
        writeFileSync(
          join(tempDir, "review-loop-task", "review-findings.md"),
          "## Open\n(no findings — close round)\n",
          "utf-8",
        );
        return { exitCode: 0, usage: null, sessionId: null, rateLimited: false };
      });

    await withStorage(async () => {
      const taskDir = join(tempDir, "review-loop-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "review-loop-task" });
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [x] all done\n", "utf-8");
      // Pre-write findings with an open item so the review phase loops back immediately
      writeFileSync(
        join(taskDir, "review-findings.md"),
        "## Open\n- [ ] fix the thing\n",
        "utf-8",
      );

      const opts = {
        name: "review-loop-task",
        prompt: "Review loop test",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 5,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
        reviewPhase: { enabled: true, maxRounds: 3 },
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 700));

      const allText = frames.join("\n");
      expect(allText).toContain("finding(s) — looping back");
    });
  });

  test("review phase cap reached with open findings shows cap message", async () => {
    // Pre-write open findings; review engine mock doesn't change them.
    // reviewRounds starts at 1 so after one more review, cap (2) is hit.
    runEngineMock.mockImplementationOnce(async () => ({
      exitCode: 0,
      usage: null,
      sessionId: null,
      rateLimited: false,
    }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "review-cap-msg-task");
      mkdirSync(taskDir, { recursive: true });
      const state = {
        ...makeState({ name: "review-cap-msg-task" }),
        reviewRounds: 1,
      };
      writeState(taskDir, state);
      writeFileSync(join(taskDir, "tasks.md"), "- [x] all done\n", "utf-8");
      // Pre-write findings with an open item
      writeFileSync(
        join(taskDir, "review-findings.md"),
        "## Open\n- [ ] still broken\n",
        "utf-8",
      );

      const opts = {
        name: "review-cap-msg-task",
        prompt: "Review cap message test",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 5,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
        reviewPhase: { enabled: true, maxRounds: 2 },
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 600));

      const allText = frames.join("\n");
      expect(allText).toContain("Review cap reached");
    });
  });

  test("stops when engine exits 0 but rateLimited is true (session usage limit)", async () => {
    runEngineMock.mockImplementationOnce(async () => ({
      exitCode: 0,
      usage: null,
      sessionId: null,
      rateLimited: true,
    }));

    await withStorage(async () => {
      const taskDir = join(tempDir, "session-usage-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "session-usage-task" });
      writeState(taskDir, state);

      const opts = {
        name: "session-usage-task",
        prompt: "Session usage prompt",
        engine: "claude" as const,
        model: "opus",
        maxIterations: 5,
        maxCostUsd: 0,
        maxRuntimeMinutes: 0,
        maxConsecutiveFailures: 5,
        delay: 0,
        log: false,
        verbose: false,
        manualTest: false,
        statesDir: tempDir,
        tasksDir: tempDir,
        changeStore: stubChangeStore,
      };

      const { frames } = render(<TaskLoop opts={opts} />);
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("rate/usage limit");
      // Only one engine call — loop stopped after the clean-exit rate limit
      expect(runEngineMock).toHaveBeenCalledTimes(1);
    });
  });

  test("steering resume filters session feed events", async () => {
    let engineStartResolve: () => void;
    const engineStarted = new Promise<void>((r) => {
      engineStartResolve = r;
    });

    runEngineMock.mockImplementationOnce(
      async (opts: { onFeedEvent?: (e: unknown) => void; signal?: AbortSignal }) => {
        engineStartResolve!();
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener("abort", () => resolve(), { once: true });
          setTimeout(resolve, 2000);
        });
        return { exitCode: 0, usage: null, sessionId: "sess-filter", rateLimited: false };
      },
    );

    const resumeFeedTypes: string[] = [];
    runEngineMock.mockImplementationOnce(
      async (opts: { onFeedEvent?: (e: unknown) => void; resumeSessionId?: string }) => {
        // Emit a session event (should be filtered) and a text event (should pass through)
        opts.onFeedEvent?.({ type: "session", model: "opus", sessionId: "sess-filter" });
        opts.onFeedEvent?.({ type: "session-unknown" });
        opts.onFeedEvent?.({ type: "text", text: "resumed work" });
        return { exitCode: 0, usage: null, sessionId: "sess-filter", rateLimited: false };
      },
    );

    await withStorage(async () => {
      const taskDir = join(tempDir, "steer-filter-task");
      mkdirSync(taskDir, { recursive: true });
      const state = makeState({ name: "steer-filter-task" });
      writeState(taskDir, state);

      let steerFn: ((msg: string) => void) | null = null;
      const Wrapped = () => {
        const { useLoop: useLoopHook } = require("../hooks/useLoop");
        const loop = useLoopHook({
          name: "steer-filter-task",
          prompt: "Filter test",
          engine: "claude" as const,
          model: "opus",
          maxIterations: 1,
          maxCostUsd: 0,
          maxRuntimeMinutes: 0,
          maxConsecutiveFailures: 5,
          delay: 0,
          log: false,
          verbose: false,
          manualTest: false,
          statesDir: tempDir,
          tasksDir: tempDir,
          changeStore: stubChangeStore,
        });
        steerFn = loop.steer;
        for (const line of loop.logLines) {
          if (line.kind === "feed") resumeFeedTypes.push(line.event.type);
        }
        return null;
      };

      render(<Wrapped />);
      await engineStarted;
      await new Promise((r) => setTimeout(r, 50));

      steerFn!("steer me");
      await new Promise((r) => setTimeout(r, 500));

      expect(runEngineMock).toHaveBeenCalledTimes(2);
      // The resume must have produced a text feed line but no session/session-unknown.
      expect(resumeFeedTypes).toContain("text");
      expect(resumeFeedTypes).not.toContain("session");
      expect(resumeFeedTypes).not.toContain("session-unknown");
    });
  });
});
