import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render } from "ink-testing-library";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { buildInitialState } from "@ralphy/core/state";
import type { State } from "@ralphy/types";
import type { BuildInitialStateOptions } from "@ralphy/core/state";
import { Banner } from "../components/Banner";
import { TaskStatus } from "../components/TaskStatus";
import { TaskList } from "../components/TaskList";
import { IterationHeader } from "../components/IterationHeader";
import { StopMessage } from "../components/StopMessage";
import { App } from "../components/App";
import type { ParsedArgs } from "../cli";

let tempDir: string;
function withStorage<T>(fn: () => T): T {
  return runWithContext(createDefaultContext(), fn);
}

function findFrame(frames: string[], text: string): string {
  return frames.find((f) => f.includes(text)) ?? frames[0] ?? "";
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "components-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeState(overrides: Partial<BuildInitialStateOptions> = {}): State {
  return buildInitialState({
    name: "test-task",
    prompt: "Test prompt text",
    ...overrides,
  });
}

describe("Banner", () => {
  test("renders task name and mode", () => {
    const state = makeState();
    const { lastFrame } = render(<Banner state={state} mode="task" taskPrompt="Do something" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Ralph Loop");
    expect(frame).toContain("test-task");
    expect(frame).toContain("task");
  });

  test("renders engine label with model", () => {
    const state = makeState({ engine: "claude", model: "sonnet" });
    const { lastFrame } = render(<Banner state={state} mode="task" />);
    const frame = lastFrame()!;
    expect(frame).toContain("claude (sonnet)");
  });

  test("shows resumed indicator when isResume is true", () => {
    const state = makeState();
    const { lastFrame } = render(<Banner state={state} mode="task" isResume />);
    expect(lastFrame()!).toContain("(resumed)");
  });

  test("shows max iterations label", () => {
    const state = makeState();
    const { lastFrame } = render(<Banner state={state} mode="task" maxIterations={10} />);
    expect(lastFrame()!).toContain("10");
  });

  test("shows unlimited when maxIterations is 0", () => {
    const state = makeState();
    const { lastFrame } = render(<Banner state={state} mode="task" maxIterations={0} />);
    expect(lastFrame()!).toContain("unlimited");
  });

  test("shows cost cap when set", () => {
    const state = makeState();
    const { lastFrame } = render(<Banner state={state} mode="task" maxCostUsd={5.5} />);
    expect(lastFrame()!).toContain("$5.5");
  });

  test("shows prompt preview in task mode", () => {
    const state = makeState();
    const { lastFrame } = render(
      <Banner state={state} mode="task" taskPrompt="Build a new feature" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Prompt");
    expect(frame).toContain("Build a new feature");
  });

  test("truncates long prompts", () => {
    const state = makeState();
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    const { lastFrame } = render(
      <Banner state={state} mode="task" taskPrompt={lines.join("\n")} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Line 1");
    expect(frame).toContain("Line 6");
    expect(frame).toContain("4 more lines");
    expect(frame).not.toContain("Line 7");
  });

  test("shows branch name", () => {
    const state = makeState();
    const { lastFrame } = render(<Banner state={state} mode="task" />);
    expect(lastFrame()!).toContain("Branch");
  });
});

describe("TaskStatus", () => {
  test("renders task name and status", () =>
    withStorage(() => {
      const state = makeState();
      const { lastFrame } = render(<TaskStatus state={state} stateDir={tempDir} />);
      const frame = lastFrame()!;
      expect(frame).toContain("test-task");
      expect(frame).toContain("active");
    }));

  test("renders usage stats", () =>
    withStorage(() => {
      const state = {
        ...makeState(),
        usage: {
          total_cost_usd: 1.234,
          total_duration_ms: 5500,
          total_turns: 3,
          total_input_tokens: 1000,
          total_output_tokens: 500,
          total_cache_read_input_tokens: 200,
          total_cache_creation_input_tokens: 0,
        },
      };
      const { lastFrame } = render(<TaskStatus state={state} stateDir={tempDir} />);
      const frame = lastFrame()!;
      expect(frame).toContain("$1.23");
      expect(frame).toContain("5.5s");
      expect(frame).toContain("1000");
      expect(frame).toContain("500");
    }));

  test("shows artifact existence checkmarks", () =>
    withStorage(() => {
      const state = makeState();
      writeFileSync(join(tempDir, "proposal.md"), "proposal content", "utf-8");
      writeFileSync(join(tempDir, "tasks.md"), "tasks content", "utf-8");
      const { lastFrame } = render(<TaskStatus state={state} stateDir={tempDir} />);
      const frame = lastFrame()!;
      expect(frame).toContain("[x] proposal.md");
      expect(frame).toContain("[x] tasks.md");
      expect(frame).toContain("[ ] design.md");
    }));

  test("shows history entries", () =>
    withStorage(() => {
      const state = {
        ...makeState(),
        history: [
          {
            timestamp: "2026-03-09T10:00:00Z",
            iteration: 1,
            engine: "claude",
            model: "opus",
            result: "success",
          },
        ],
      };
      const { lastFrame } = render(<TaskStatus state={state} stateDir={tempDir} />);
      const frame = lastFrame()!;
      expect(frame).toContain("success");
    }));
});

describe("TaskList", () => {
  test("shows 'No incomplete tasks' when empty", () =>
    withStorage(() => {
      mkdirSync(tempDir, { recursive: true });
      const { lastFrame } = render(<TaskList statesDir={tempDir} />);
      expect(lastFrame()!).toContain("No incomplete tasks");
    }));

  test("renders change rows for active changes", () =>
    withStorage(() => {
      const stateDir = join(tempDir, "my-change");
      mkdirSync(stateDir, { recursive: true });
      const state = makeState({ name: "my-change", prompt: "Build something" });
      writeFileSync(join(stateDir, ".ralph-state.json"), JSON.stringify(state), "utf-8");

      const { frames } = render(<TaskList statesDir={tempDir} />);
      const frame = findFrame(frames, "my-change");
      expect(frame).toContain("my-change");
      expect(frame).toContain("Build something");
    }));

  test("skips changes with status=completed", () =>
    withStorage(() => {
      const stateDir = join(tempDir, "done-change");
      mkdirSync(stateDir, { recursive: true });
      const state = { ...makeState({ name: "done-change" }), status: "completed" as const };
      writeFileSync(join(stateDir, ".ralph-state.json"), JSON.stringify(state), "utf-8");

      const { lastFrame } = render(<TaskList statesDir={tempDir} />);
      expect(lastFrame()!).toContain("No incomplete tasks");
    }));

  test("shows progress counts when tasks.md exists", () =>
    withStorage(() => {
      const stateDir = join(tempDir, "prog-change");
      mkdirSync(stateDir, { recursive: true });
      const state = makeState({ name: "prog-change", prompt: "Test" });
      writeFileSync(join(stateDir, ".ralph-state.json"), JSON.stringify(state), "utf-8");
      writeFileSync(join(stateDir, "tasks.md"), "- [x] One\n- [x] Two\n- [ ] Three\n", "utf-8");

      const { frames } = render(<TaskList statesDir={tempDir} />);
      const frame = findFrame(frames, "prog-change");
      expect(frame).toContain("prog-change");
      expect(frame).toContain("2/3");
    }));

  test("renders table headers", () =>
    withStorage(() => {
      const stateDir = join(tempDir, "header-change");
      mkdirSync(stateDir, { recursive: true });
      const state = makeState({ name: "header-change", prompt: "Test" });
      writeFileSync(join(stateDir, ".ralph-state.json"), JSON.stringify(state), "utf-8");

      const { lastFrame } = render(<TaskList statesDir={tempDir} />);
      const frame = lastFrame()!;
      expect(frame).toContain("Name");
      expect(frame).toContain("Status");
      expect(frame).toContain("Description");
    }));
});

describe("IterationHeader", () => {
  test("renders iteration number", () => {
    const { lastFrame } = render(<IterationHeader iteration={3} time="12:34:56" />);
    const frame = lastFrame()!;
    expect(frame).toContain("#3");
  });

  test("renders time", () => {
    const { lastFrame } = render(<IterationHeader iteration={1} time="09:15:00" />);
    expect(lastFrame()!).toContain("09:15:00");
  });
});

describe("StopMessage", () => {
  test("renders completed stop", () => {
    const state = makeState();
    const { lastFrame } = render(
      <StopMessage reason="completed" state={state} stateDir={tempDir} consecutiveFailures={0} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("completed");
  });

  test("renders maxIterations stop", () => {
    const state = makeState();
    const { lastFrame } = render(
      <StopMessage
        reason="maxIterations"
        state={state}
        stateDir={tempDir}
        maxIterations={10}
        consecutiveFailures={0}
      />,
    );
    expect(lastFrame()!).toContain("10");
  });

  test("renders costCap stop", () => {
    const state = {
      ...makeState(),
      usage: {
        total_cost_usd: 5.99,
        total_duration_ms: 0,
        total_turns: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_read_input_tokens: 0,
        total_cache_creation_input_tokens: 0,
      },
    };
    const { lastFrame } = render(
      <StopMessage
        reason="costCap"
        state={state}
        stateDir={tempDir}
        maxCostUsd={6}
        consecutiveFailures={0}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("$5.99");
    expect(frame).toContain("$6");
  });

  test("renders runtimeLimit stop", () => {
    const state = makeState();
    const { lastFrame } = render(
      <StopMessage
        reason="runtimeLimit"
        state={state}
        stateDir={tempDir}
        maxRuntimeMinutes={30}
        consecutiveFailures={0}
      />,
    );
    expect(lastFrame()!).toContain("30 minute");
  });

  test("renders consecutiveFailures stop", () => {
    const state = makeState();
    const { lastFrame } = render(
      <StopMessage
        reason="consecutiveFailures"
        state={state}
        stateDir={tempDir}
        consecutiveFailures={5}
      />,
    );
    expect(lastFrame()!).toContain("5 consecutive identical failures");
  });

  test("renders rateLimited stop", () => {
    const state = makeState();
    const { lastFrame } = render(
      <StopMessage reason="rateLimited" state={state} stateDir={tempDir} consecutiveFailures={0} />,
    );
    expect(lastFrame()!).toContain("rate/usage limit");
  });
});

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    mode: "task",
    name: "",
    prompt: "",
    engine: "claude",
    model: "opus",
    engineSet: false,
    maxIterations: 0,
    maxCostUsd: 0,
    maxRuntimeMinutes: 0,
    maxConsecutiveFailures: 5,
    delay: 0,
    log: false,
    verbose: false,
    manualTest: false,
    fromAgent: false,
    linearTeam: "",
    linearAssignee: "",
    pollInterval: 60,
    concurrency: 1,
    worktree: false,
    indicators: {},
    createPr: false,
    fixCi: false,
    codeReview: false,
    maxTickets: 0,
    jsonOutput: false,
    ...overrides,
  };
}

describe("App", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test("list mode renders TaskList", () =>
    withStorage(() => {
      mkdirSync(tempDir, { recursive: true });
      const { lastFrame } = render(
        <App
          args={makeArgs({ mode: "list" })}
          statesDir={tempDir}
          tasksDir={tempDir}
          projectRoot={tempDir}
        />,
      );
      expect(lastFrame()!).toContain("No incomplete tasks");
    }));

  test("status mode without name shows error", async () => {
    const { frames } = withStorage(() =>
      render(
        <App
          args={makeArgs({ mode: "status" })}
          statesDir={tempDir}
          tasksDir={tempDir}
          projectRoot={tempDir}
        />,
      ),
    );
    await tick();
    const frame = findFrame(frames, "--name is required");
    expect(frame).toContain("--name is required");
    process.exitCode = 0;
  });

  test("status mode with missing change shows error", async () => {
    const { lastFrame } = withStorage(() =>
      render(
        <App
          args={makeArgs({ mode: "status", name: "nonexistent" })}
          statesDir={tempDir}
          tasksDir={tempDir}
          projectRoot={tempDir}
        />,
      ),
    );
    expect(lastFrame()!).toContain("not found");
    await tick();
    process.exitCode = 0;
  });

  test("status mode renders TaskStatus for existing change", () =>
    withStorage(() => {
      const stateDir = join(tempDir, "my-change");
      mkdirSync(stateDir, { recursive: true });
      const state = makeState({ name: "my-change" });
      writeFileSync(join(stateDir, ".ralph-state.json"), JSON.stringify(state), "utf-8");

      const { lastFrame } = render(
        <App
          args={makeArgs({ mode: "status", name: "my-change" })}
          statesDir={tempDir}
          tasksDir={tempDir}
          projectRoot={tempDir}
        />,
      );
      const frame = lastFrame()!;
      expect(frame).toContain("my-change");
    }));

  test("task mode without name shows error", async () => {
    const { frames } = withStorage(() =>
      render(
        <App
          args={makeArgs({ mode: "task" })}
          statesDir={tempDir}
          tasksDir={tempDir}
          projectRoot={tempDir}
        />,
      ),
    );
    await tick();
    const frame = findFrame(frames, "--name is required");
    expect(frame).toContain("--name is required");
    process.exitCode = 0;
  });

  test("agent mode renders AgentMode (exits gracefully without LINEAR_API_KEY)", async () => {
    const prevKey = process.env["LINEAR_API_KEY"];
    delete process.env["LINEAR_API_KEY"];
    // AgentMode's catch handler calls process.exit(1) after ~300ms; mock it so
    // the timer doesn't kill the bun test process during coverage generation.
    const originalExit = process.exit;
    let capturedExitCode: number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = (code?: number) => {
      capturedExitCode = code;
    };
    try {
      await withStorage(async () => {
        const { frames } = render(
          <App
            args={makeArgs({ mode: "agent" })}
            statesDir={tempDir}
            tasksDir={tempDir}
            projectRoot={tempDir}
          />,
        );
        await new Promise((r) => setTimeout(r, 150));
        const text = frames.join("\n");
        expect(text).toContain("agent mode");
        expect(text).toContain("LINEAR_API_KEY not set");
        // Wait for the force-exit timer (100ms + 200ms) to fire against the mock.
        await new Promise((r) => setTimeout(r, 250));
        expect(capturedExitCode).toBe(1);
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = originalExit;
      if (prevKey !== undefined) process.env["LINEAR_API_KEY"] = prevKey;
    }
  });
});
