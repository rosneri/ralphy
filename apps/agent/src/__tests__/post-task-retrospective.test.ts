import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPostTask, type RetroDispositionInfo } from "../agent/post-task";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";
import type { LinearIssue } from "../agent/linear";

// The optional `runRetrospective` dep (wired only under --agent-debug) must run
// exactly once, after the terminal disposition emit and before worktree
// cleanup, and must never alter the effective exit code. When absent the flow
// is identical.

const FAKE_ISSUE: LinearIssue = {
  id: "issue-1",
  identifier: "COD-1",
  title: "Test issue",
  url: "https://linear.app/team/issue/COD-1",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

function makeCmd(): CmdRunner {
  return { run: async () => ({ stdout: "", stderr: "" }) };
}

describe("runPostTask — retrospective hook", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-retro-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseInput = (overrides: { exitCode?: number } = {}) => ({
    changeName: "my-change",
    cwd: tmpDir,
    projectRoot: tmpDir,
    changeDir,
    stateFilePath,
    branch: "ralph/my-change",
    issue: FAKE_ISSUE,
    exitCode: overrides.exitCode ?? 0,
    useWorktree: false,
    wantPr: false,
    wantAutoMerge: false,
    cfg: {
      teardownScript: null,
      prBaseBranch: "main",
      autoMergeStrategy: "squash" as const,
      cleanupWorktreeOnSuccess: false,
      stackPrsOnDependencies: false,
      neverTouch: [],
    },
    respawnWorker: async () => 0,
  });

  test("invokes the dep once, before cleanup, with the effective exit code", async () => {
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };
    const order: string[] = [];
    const infos: RetroDispositionInfo[] = [];

    const code = await runPostTask(baseInput(), {
      cmd: makeCmd(),
      git,
      log: () => {},
      runScript: async () => {},
      runRetrospective: async (info) => {
        infos.push(info);
        order.push("retro");
      },
      onPhase: (phase) => order.push(`phase.${phase}`),
    });

    expect(infos).toHaveLength(1);
    expect(infos[0]?.changeName).toBe("my-change");
    expect(infos[0]?.effectiveCode).toBe(code);
    // Retro runs after the terminal emit and strictly before teardown/cleanup.
    expect(order).toContain("retro");
    const retroIdx = order.indexOf("retro");
    const teardownIdx = order.indexOf("phase.teardown");
    if (teardownIdx !== -1) expect(retroIdx).toBeLessThan(teardownIdx);
  });

  test("exit code is identical whether the dep is present or absent", async () => {
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

    const withoutDep = await runPostTask(baseInput(), {
      cmd: makeCmd(),
      git,
      log: () => {},
      runScript: async () => {},
    });

    let called = 0;
    const withDep = await runPostTask(baseInput(), {
      cmd: makeCmd(),
      git,
      log: () => {},
      runScript: async () => {},
      runRetrospective: async () => {
        called += 1;
      },
    });

    expect(called).toBe(1);
    expect(withDep).toBe(withoutDep);
  });
});
