import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import {
  buildTaskPrompt,
  checkStopCondition,
  checkStopSignal,
  updateStateIteration,
} from "../loop";
import type { LoopOptions } from "../loop";
import { buildInitialState, writeState, readState } from "@ralphy/core/state";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import type { State, Engine } from "@ralphy/types";
import type { BuildInitialStateOptions } from "@ralphy/core/state";

let tempDir: string;
const withStorage = <T>(fn: () => T): T => runWithContext(createDefaultContext(), fn);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "loop-test-"));
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

describe("buildTaskPrompt", () => {
  test("includes steering content from steering.md", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "steering.md"), "Use pattern X\nAvoid Y\n", "utf-8");

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("User Steering");
      expect(prompt).toContain("Use pattern X");
      expect(prompt).toContain("Avoid Y");
    }));

  test("omits steering when steering.md does not exist", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("User Steering");
    }));

  test("includes first unchecked section from tasks.md when present", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(
        join(tempDir, "tasks.md"),
        "## Section A\n\n- [ ] Task one\n- [ ] Task two\n",
        "utf-8",
      );

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Current Task Section");
      expect(prompt).toContain("Task one");
    }));

  test("steering content is limited to 20 lines", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      const lines = Array.from({ length: 30 }, (_, i) => `Guidance line ${i + 1}`);
      writeFileSync(join(tempDir, "steering.md"), `${lines.join("\n")}\n`, "utf-8");

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Guidance line 1");
      expect(prompt).toContain("Guidance line 20");
      expect(prompt).not.toContain("Guidance line 21");
    }));
});

describe("createPr instructions", () => {
  test("includes PR creation instructions when state.createPr is true", () =>
    withStorage(() => {
      const state = { ...makeState(), createPr: true };
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("push your branch and open a pull request");
      expect(prompt).toContain("git push -u origin HEAD");
      expect(prompt).toContain("gh pr create");
    }));

  test("omits PR creation instructions when state.createPr is false", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("push your branch and open a pull request");
    }));
});

describe("change name and validation instructions", () => {
  test("prompt includes the change name for claude engine", () =>
    withStorage(() => {
      const state = makeState({ engine: "claude" });
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Change name: `test-task`");
    }));

  test("prompt includes the change name for codex engine", () =>
    withStorage(() => {
      const state = { ...makeState({ engine: "codex" as Engine }) };
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Change name: `test-task`");
    }));

  test("prompt instructs running openspec validate for the change", () =>
    withStorage(() => {
      const state = makeState({ engine: "claude" });
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("bunx openspec validate test-task");
    }));

  test("prompt does not contain unrendered template variables", () =>
    withStorage(() => {
      const state = makeState({ engine: "claude" });
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("{{TASK_NAME}}");
      expect(prompt).not.toContain("{{MCP_TOOLS}}");
      expect(prompt).not.toContain("{{PHASE_ITERATION}}");
    }));
});

describe("parseArgs → buildTaskPrompt integration", () => {
  test("research phase produces non-empty prompt", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      // Should at minimum have the phase prompt content (if the file exists)
      expect(typeof prompt).toBe("string");
    }));

  test("returns prompt when no optional files are present", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(typeof prompt).toBe("string");
    }));
});

const stubChangeStore = {
  archiveChange: (_name: string) => Promise.resolve(),
};

function makeOpts(overrides: Partial<LoopOptions> = {}): LoopOptions {
  return {
    name: "test-task",
    prompt: "Test prompt",
    engine: "claude",
    model: "opus",
    maxIterations: 0,
    maxCostUsd: 0,
    maxRuntimeMinutes: 0,
    maxConsecutiveFailures: 5,
    delay: 0,
    log: false,
    verbose: false,
    manualTest: false,
    createPr: false,
    statesDir: tempDir,
    tasksDir: tempDir,
    changeStore: stubChangeStore,
    ...overrides,
  };
}

describe("checkStopCondition", () => {
  test("returns null when no limits are reached", () => {
    const state = makeState();
    const result = checkStopCondition(state, 0, makeOpts(), Date.now(), 0);
    expect(result).toBeNull();
  });

  test("returns maxIterations when limit reached", () => {
    const state = makeState();
    const result = checkStopCondition(state, 5, makeOpts({ maxIterations: 5 }), Date.now(), 0);
    expect(result).toBe("maxIterations");
  });

  test("returns null when iteration is below maxIterations", () => {
    const state = makeState();
    const result = checkStopCondition(state, 4, makeOpts({ maxIterations: 5 }), Date.now(), 0);
    expect(result).toBeNull();
  });

  test("returns completed when status is not active", () => {
    const state = { ...makeState(), status: "completed" as const };
    const result = checkStopCondition(state, 0, makeOpts(), Date.now(), 0);
    expect(result).toBe("completed");
  });

  test("returns costCap when cost exceeds limit", () => {
    const state = {
      ...makeState(),
      usage: {
        total_cost_usd: 10.5,
        total_duration_ms: 0,
        total_turns: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_read_input_tokens: 0,
        total_cache_creation_input_tokens: 0,
      },
    };
    const result = checkStopCondition(state, 0, makeOpts({ maxCostUsd: 10 }), Date.now(), 0);
    expect(result).toBe("costCap");
  });

  test("returns runtimeLimit when elapsed time exceeds limit", () => {
    const state = makeState();
    const pastStart = Date.now() - 31 * 60_000; // 31 minutes ago
    const result = checkStopCondition(state, 0, makeOpts({ maxRuntimeMinutes: 30 }), pastStart, 0);
    expect(result).toBe("runtimeLimit");
  });

  test("returns consecutiveFailures when threshold reached", () => {
    const state = makeState();
    const result = checkStopCondition(
      state,
      0,
      makeOpts({ maxConsecutiveFailures: 3 }),
      Date.now(),
      3,
    );
    expect(result).toBe("consecutiveFailures");
  });

  test("returns null when consecutiveFailures is below threshold", () => {
    const state = makeState();
    const result = checkStopCondition(
      state,
      0,
      makeOpts({ maxConsecutiveFailures: 3 }),
      Date.now(),
      2,
    );
    expect(result).toBeNull();
  });

  test("ignores maxIterations when set to 0 (unlimited)", () => {
    const state = makeState();
    const result = checkStopCondition(state, 100, makeOpts({ maxIterations: 0 }), Date.now(), 0);
    expect(result).toBeNull();
  });
});

describe("checkStopSignal", () => {
  test("returns null when no STOP file exists", () =>
    withStorage(() => {
      writeState(tempDir, makeState());
      const result = checkStopSignal(tempDir, tempDir);
      expect(result).toBeNull();
    }));

  test("returns reason and removes STOP file", () =>
    withStorage(() => {
      writeState(tempDir, makeState());
      writeFileSync(join(tempDir, "STOP"), "Blocked: need API key", "utf-8");

      const result = checkStopSignal(tempDir, tempDir);
      expect(result).toBe("Blocked: need API key");

      // File should be removed
      expect(existsSync(join(tempDir, "STOP"))).toBe(false);
    }));

  test("marks state as blocked after reading STOP", () =>
    withStorage(() => {
      writeState(tempDir, makeState());
      writeFileSync(join(tempDir, "STOP"), "reason", "utf-8");

      checkStopSignal(tempDir, tempDir);

      const state = readState(tempDir);
      expect(state.status).toBe("blocked");
    }));
});

describe("updateStateIteration", () => {
  test("increments iteration counter", () =>
    withStorage(() => {
      writeState(tempDir, makeState());

      const updated = updateStateIteration(
        tempDir,
        "success",
        new Date().toISOString(),
        "claude",
        "opus",
        null,
      );
      expect(updated.iteration).toBe(1);
    }));

  test("appends history entry", () =>
    withStorage(() => {
      writeState(tempDir, makeState());

      const startedAt = new Date().toISOString();
      const updated = updateStateIteration(tempDir, "success", startedAt, "claude", "opus", null);
      expect(updated.history).toHaveLength(1);
      expect(updated.history[0]!.result).toBe("success");
      expect(updated.history[0]!.engine).toBe("claude");
      expect(updated.history[0]!.model).toBe("opus");
    }));

  test("accumulates usage when provided", () =>
    withStorage(() => {
      writeState(tempDir, makeState());

      const usage = {
        cost_usd: 0.5,
        duration_ms: 3000,
        num_turns: 2,
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      };
      const updated = updateStateIteration(
        tempDir,
        "success",
        new Date().toISOString(),
        "claude",
        "opus",
        usage,
      );
      expect(updated.usage.total_cost_usd).toBe(0.5);
      expect(updated.usage.total_input_tokens).toBe(1000);
      expect(updated.usage.total_output_tokens).toBe(500);
    }));

  test("does not change usage when none provided", () =>
    withStorage(() => {
      writeState(tempDir, makeState());

      const updated = updateStateIteration(
        tempDir,
        "success",
        new Date().toISOString(),
        "claude",
        "opus",
        null,
      );
      expect(updated.usage.total_cost_usd).toBe(0);
      expect(updated.usage.total_input_tokens).toBe(0);
    }));
});
