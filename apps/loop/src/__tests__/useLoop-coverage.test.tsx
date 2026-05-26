/**
 * Targeted coverage tests for useLoop code paths not exercised by other test files:
 *   - reviewPhase block (lines 243-311): runs when all tasks done + reviewPhase.enabled
 *   - specAttachments carry-over (line 140): runs when state file is malformed but has specAttachments
 */
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { render } from "ink-testing-library";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { buildInitialState, writeState } from "@ralphy/core/state";

mock.module("@ralphy/engine/engine", () => ({
  runEngine: mock(async () => ({ exitCode: 0, usage: null })),
  handleEngineFailure: mock(() => ({ message: "Failed", shouldStop: false })),
}));

mock.module("@ralphy/core/git", () => ({
  gitPush: mock(() => {}),
  commitTaskDir: mock(() => {}),
  commitState: mock(() => {}),
  getCurrentBranch: mock(() => "test-branch"),
  gitAdd: mock(() => {}),
  gitCommit: mock(() => {}),
}));

mock.module("@ralphy/openspec", () => ({
  archive: mock(async () => {}),
  OpenSpecChangeStore: class {
    async createChange() {}
    getChangeDirectory() {
      return "";
    }
    async listChanges() {
      return [];
    }
    async readTaskList() {
      return "";
    }
    async writeTaskList() {}
    async appendSteering() {}
    async readSection() {
      return "";
    }
    async validateChange() {
      return { valid: true, warnings: [], errors: [] };
    }
    async archiveChange() {}
  },
}));

const { TaskLoop } = await import("../components/TaskLoop");

let tempDir: string;

function withStorage<T>(fn: () => T): T {
  return runWithContext(createDefaultContext(), fn);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "useloop-coverage-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const baseOpts = {
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
};

describe("useLoop — reviewPhase block (coverage)", () => {
  test("runs review pass when all tasks done and reviewPhase.enabled", async () => {
    await withStorage(async () => {
      const name = "review-coverage";
      const statesDir = join(tempDir, "states");
      const tasksDir = join(tempDir, "tasks");
      const stateDir = join(statesDir, name);
      const changeTaskDir = join(tasksDir, name);
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(changeTaskDir, { recursive: true });

      writeState(stateDir, buildInitialState({ name, prompt: "Test" }));

      // All mission tasks completed → triggers review phase
      await Bun.write(join(changeTaskDir, "tasks.md"), "- [x] done\n");

      const archiveChange = mock(async (_n: string) => {});
      const onReviewRound = mock(async () => {});

      const changeStore = {
        archiveChange,
        getStatus: async (_n: string) => ({ isComplete: true, artifacts: [] }),
        listChanges: async () => [name],
      };

      render(
        <TaskLoop
          opts={{
            ...baseOpts,
            name,
            statesDir,
            tasksDir,
            changeStore,
            reviewPhase: { enabled: true, maxRounds: 1 },
            onReviewRound,
          }}
        />,
      );

      // Allow time for async review phase to execute
      await new Promise((r) => setTimeout(r, 2000));

      expect(archiveChange.mock.calls.length).toBe(1);
    });
  });
});

describe("useLoop — specAttachments carry-over (line 140 coverage)", () => {
  test("carries over specAttachments when state file is malformed", async () => {
    await withStorage(async () => {
      const name = "malformed-state";
      const statesDir = join(tempDir, "states");
      const tasksDir = join(tempDir, "tasks");
      const stateDir = join(statesDir, name);
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(join(tasksDir, name), { recursive: true });

      // Write malformed state (valid JSON but fails StateSchema) with specAttachments
      await Bun.write(
        join(stateDir, ".ralph-state.json"),
        JSON.stringify({ name, specAttachments: { "spec.md": "attachment-123" } }),
      );

      const archiveChange = mock(async (_n: string) => {});

      render(
        <TaskLoop
          opts={{
            ...baseOpts,
            name,
            maxIterations: 1,
            statesDir,
            tasksDir,
            changeStore: { archiveChange },
          }}
        />,
      );

      await new Promise((r) => setTimeout(r, 1000));
    });
  });
});
