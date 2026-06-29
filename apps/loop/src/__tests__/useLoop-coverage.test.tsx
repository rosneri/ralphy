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
import type { ProjectLayout } from "@ralphy/types";
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
  // Default to a clean worktree so the LIT-303 archive guard doesn't trip.
  getUncommittedFiles: mock(() => []),
  excludeFrameworkOwnedPaths: mock((lines: readonly string[]) => lines),
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

function makeLayout(statesDir: string, tasksDir: string): ProjectLayout {
  return {
    root: statesDir,
    statesDir,
    tasksDir,
    agentStateFile: join(statesDir, "agent-state.json"),
    changeDir: (name) => join(tasksDir, name),
    taskStateDir: (name) => join(statesDir, name),
    stateFile: (name) => join(statesDir, name, ".ralph-state.json"),
  };
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
    const name = "review-coverage";
    const statesDir = join(tempDir, "states");
    const tasksDir = join(tempDir, "tasks");
    const stateDir = join(statesDir, name);
    const changeTaskDir = join(tasksDir, name);
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(changeTaskDir, { recursive: true });

    const archiveChange = mock(async (_n: string) => {});
    const onReviewRound = mock(async () => {});

    const changeStore = {
      archiveChange,
      getStatus: async (_n: string) => ({
        changeName: _n,
        isComplete: true,
        artifacts: [],
        applyRequires: [],
      }),
      listChanges: async () => [name],
    };

    await runWithContext(
      createDefaultContext({ layout: makeLayout(statesDir, tasksDir) }),
      async () => {
        writeState(stateDir, buildInitialState({ name, prompt: "Test" }));

        // All mission tasks completed → triggers review phase
        await Bun.write(join(changeTaskDir, "tasks.md"), "- [x] done\n");

        render(
          <TaskLoop
            opts={{
              ...baseOpts,
              name,
              changeStore,
              reviewPhase: { enabled: true, maxRounds: 1 },
              onReviewRound,
            }}
          />,
        );

        // Allow time for async review phase to execute
        await new Promise((r) => setTimeout(r, 2000));

        expect(archiveChange.mock.calls.length).toBe(1);
      },
    );
  });
});

describe("useLoop — specAttachments carry-over (line 140 coverage)", () => {
  test("carries over specAttachments when state file is malformed", async () => {
    const name = "malformed-state";
    const statesDir = join(tempDir, "states");
    const tasksDir = join(tempDir, "tasks");
    const stateDir = join(statesDir, name);
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(tasksDir, name), { recursive: true });

    const archiveChange = mock(async (_n: string) => {});

    await runWithContext(
      createDefaultContext({ layout: makeLayout(statesDir, tasksDir) }),
      async () => {
        // Write malformed state (valid JSON but fails StateSchema) with specAttachments
        await Bun.write(
          join(stateDir, ".ralph-state.json"),
          JSON.stringify({ name, specAttachments: { "spec.md": "attachment-123" } }),
        );

        render(
          <TaskLoop
            opts={{
              ...baseOpts,
              name,
              maxIterations: 1,
              changeStore: { archiveChange },
            }}
          />,
        );

        await new Promise((r) => setTimeout(r, 1000));
      },
    );
  });
});
