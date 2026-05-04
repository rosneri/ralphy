import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { render } from "ink-testing-library";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { buildInitialState, writeState } from "@ralphy/core/state";
import type { State } from "@ralphy/types";
import type { BuildInitialStateOptions } from "@ralphy/core/state";
import type { ParsedArgs } from "../cli";

// Mock engine module
mock.module("@ralphy/engine/engine", () => ({
  runEngine: mock(async () => ({ exitCode: 0, usage: null })),
  handleEngineFailure: mock((exitCode: number) => ({
    message: `Failed (exit ${exitCode})`,
    shouldStop: false,
  })),
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
  // Stub so `new OpenSpecChangeStore()` in App.tsx resolves during module load.
  // Tests that need store behavior inject their own stub via props.
  OpenSpecChangeStore: class {
    async createChange(): Promise<void> {}
    getChangeDirectory(): string {
      return "";
    }
    async listChanges(): Promise<string[]> {
      return [];
    }
    async readTaskList(): Promise<string> {
      return "";
    }
    async writeTaskList(): Promise<void> {}
    async appendSteering(): Promise<void> {}
    async readSection(): Promise<string> {
      return "";
    }
    async validateChange(): Promise<{ valid: boolean; warnings: string[]; errors: string[] }> {
      return { valid: true, warnings: [], errors: [] };
    }
    async archiveChange(): Promise<void> {}
  },
}));

// Import after mocking
const { App } = await import("../components/App");

let tempDir: string;

function withStorage<T>(fn: () => T): T {
  return runWithContext(createDefaultContext(), fn);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "app-task-test-"));
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
    linearTeam: "",
    linearAssignee: "",
    linearStatus: [],
    linearLabel: [],
    pollInterval: 60,
    concurrency: 1,
    worktree: false,
    ...overrides,
  };
}

describe("App task mode", () => {
  test("task mode with valid name renders TaskLoop", async () => {
    await withStorage(async () => {
      const stateDir = join(tempDir, "my-task");
      mkdirSync(stateDir, { recursive: true });
      const state = makeState({ name: "my-task" });
      writeState(stateDir, state);

      const args = makeArgs({
        mode: "task",
        name: "my-task",
        prompt: "Do something",
        maxIterations: 1,
      });

      const { frames } = render(
        <App args={args} statesDir={tempDir} tasksDir={tempDir} projectRoot={tempDir} />,
      );
      await new Promise((r) => setTimeout(r, 500));

      const allText = frames.join("\n");
      expect(allText).toContain("Ralph Loop");
      expect(allText).toContain("my-task");
    });
  });
});
