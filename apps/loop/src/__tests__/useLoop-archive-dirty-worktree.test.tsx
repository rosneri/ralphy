/**
 * Regression: LIT-303 incident — when the loop resumed a change whose
 * `tasks.md` was fully checked off but whose worktree still had uncommitted
 * implementation edits, it short-circuited to "archive change" without
 * iterating, stranding the work. The archive path must refuse to fire when
 * the worktree is dirty.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { render } from "ink-testing-library";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { buildInitialState, writeState } from "@ralphy/core/state";
import type { ProjectLayout } from "@ralphy/types";

// Per-test mutable flag the git mock consults. Set before render().
let mockUncommittedPorcelain = "";

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
  // New surface introduced by the LIT-303 fix. Returns the parsed lines of
  // `git status --porcelain` (empty array = clean worktree). Tests vary this
  // via the `mockUncommittedPorcelain` flag.
  getUncommittedFiles: mock(() => mockUncommittedPorcelain.split("\n").filter((l) => l.length > 0)),
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
  tempDir = mkdtempSync(join(tmpdir(), "useloop-dirty-"));
  mockUncommittedPorcelain = "";
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

interface Scenario {
  name: string;
  porcelain: string;
}

async function runScenario(s: Scenario): Promise<{ archiveCalls: number }> {
  const statesDir = join(tempDir, "states");
  const tasksDir = join(tempDir, "tasks");
  const stateDir = join(statesDir, s.name);
  const changeTaskDir = join(tasksDir, s.name);
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
    listChanges: async () => [s.name],
  };

  mockUncommittedPorcelain = s.porcelain;

  await runWithContext(
    createDefaultContext({ layout: makeLayout(statesDir, tasksDir) }),
    async () => {
      writeState(stateDir, buildInitialState({ name: s.name, prompt: "Test" }));
      await Bun.write(join(changeTaskDir, "tasks.md"), "- [x] done\n");

      render(
        <TaskLoop
          opts={{
            ...baseOpts,
            name: s.name,
            changeStore,
            reviewPhase: { enabled: true, maxRounds: 1 },
            onReviewRound,
          }}
        />,
      );
      // Allow time for async review phase + archive decision.
      await new Promise((r) => setTimeout(r, 2000));
    },
  );

  return { archiveCalls: archiveChange.mock.calls.length };
}

describe("useLoop archive guard — refuses to archive when worktree is dirty", () => {
  // Sanity guard: clean worktree + all tasks done still archives normally.
  test("clean worktree + all tasks done → archives as before", async () => {
    const { archiveCalls } = await runScenario({ name: "clean-archive", porcelain: "" });
    expect(archiveCalls).toBe(1);
  });

  // fix_case: dirty worktree + all tasks done → MUST NOT archive.
  // Reproduces LIT-303. Fails today because useLoop has no guard.
  test("fix_case: dirty worktree + all tasks done → archive is skipped", async () => {
    const { archiveCalls } = await runScenario({
      name: "dirty-no-archive",
      porcelain:
        " M apps/game-astro/src/components/character/post-json.ts\n" +
        " M libs/game-persistence/src/character/character-loader-types.ts\n" +
        " M libs/jobs/src/types.ts\n",
    });
    expect(archiveCalls).toBe(0);
  });

  // bug_case (post-fix): regression guard. Before the fix, useLoop archived
  // the change regardless of worktree state, orphaning the stranded diff and
  // letting Linear be flipped to a done state with no PR. The archive must
  // never fire while files are uncommitted.
  test("bug_case (regression guard): archive never fires while any file is uncommitted", async () => {
    const { archiveCalls } = await runScenario({
      name: "dirty-still-archives",
      porcelain: " M libs/jobs/src/types.ts\n",
    });
    expect(archiveCalls).not.toBe(1);
  });
});
