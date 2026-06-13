import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPostTask, NO_CHANGES_EXIT } from "../agent/post-task";

/** Mirror of the un-exported PR_FAILED_EXIT constant in post-task.ts. */
const PR_FAILED_EXIT = 71;
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";
import type { TrackedIssue } from "@ralphy/tracker";

// RLF-257 keystone invariant: worktree cleanup + teardown must each run
// EXACTLY ONCE for every terminal outcome of runPostTask — including the
// throw path, which the pre-refactor code skipped entirely (no finally).
// We count cleanup via the "cleanup" phase emit (fires whenever
// runWorktreeCleanupPhase executes with a real worktree) and teardown via
// both the "teardown" emit and the runScript("teardown", ...) invocation.

const FAKE_ISSUE: TrackedIssue = {
  id: "issue-1",
  identifier: "RLF-257",
  title: "Single teardown",
  url: "https://linear.app/team/issue/RLF-257",
  description: "",
  priority: 2,
  createdAt: "2026-06-13T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

interface CmdResponse {
  stdout?: string;
  stderr?: string;
  throw?: boolean;
}

function makeCmd(responses: Record<string, CmdResponse>): { cmd: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const cmd: CmdRunner = {
    run: async (args) => {
      calls.push([...args]);
      const key = args.join(" ");
      for (const [prefix, r] of Object.entries(responses)) {
        if (key.startsWith(prefix)) {
          if (r.throw) {
            const err = new Error("cmd failed") as Error & { stderr?: string };
            err.stderr = r.stderr ?? "";
            throw err;
          }
          return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        }
      }
      return { stdout: "", stderr: "" };
    },
  };
  return { cmd, calls };
}

const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

describe("runPostTask — single teardown invariant", () => {
  let tmpDir: string;
  let projectRoot: string;
  let worktree: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-single-teardown-"));
    // A real worktree path (≠ projectRoot) so runWorktreeCleanupPhase always
    // reaches its "cleanup" emit. cleanupWorktreeOnSuccess stays false so the
    // phase returns right after the emit without touching the git runner.
    projectRoot = join(tmpDir, "project");
    worktree = join(tmpDir, "worktree");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(worktree, { recursive: true });
    changeDir = join(worktree, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    await Bun.write(join(changeDir, "agent-tasks.md"), "## flow\n\n- [x] something\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "active", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function counters() {
    const phases: string[] = [];
    let teardownScriptRuns = 0;
    return {
      phases,
      get cleanupRuns() {
        return phases.filter((p) => p === "cleanup").length;
      },
      get teardownEmits() {
        return phases.filter((p) => p === "teardown").length;
      },
      get teardownScriptRuns() {
        return teardownScriptRuns;
      },
      onPhase: (p: string) => phases.push(p),
      runScript: async (label: string) => {
        if (label === "teardown") teardownScriptRuns += 1;
      },
    };
  }

  const baseInput = (overrides: Partial<Parameters<typeof runPostTask>[0]> = {}) => ({
    mode: "fresh" as const,
    changeName: "my-change",
    cwd: worktree,
    projectRoot,
    changeDir,
    stateFilePath,
    branch: "ralph/my-change",
    issue: FAKE_ISSUE,
    exitCode: 0,
    useWorktree: true,
    wantPr: true,
    wantAutoMerge: false,
    cfg: {
      teardownScript: "echo done",
      prBaseBranch: "main",
      autoMergeStrategy: "squash" as const,
      cleanupWorktreeOnSuccess: false,
      stackPrsOnDependencies: false,
      neverTouch: [],
    },
    respawnWorker: async () => 0,
    ...overrides,
  });

  function assertOnce(c: ReturnType<typeof counters>) {
    expect(c.cleanupRuns).toBe(1);
    expect(c.teardownEmits).toBe(1);
    expect(c.teardownScriptRuns).toBe(1);
  }

  test("PR success → cleanup + teardown each run once", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/owner/repo/pull/1" },
    });
    const c = counters();
    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: () => {},
      runScript: c.runScript,
      onPhase: c.onPhase,
    });
    expect(code).toBe(0);
    assertOnce(c);
  });

  test("PR-failed (PR_FAILED_EXIT) → cleanup + teardown each run once", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { throw: true },
    });
    const c = counters();
    const code = await runPostTask(baseInput({ respawnWorker: async () => 1 }), {
      cmd,
      git,
      log: () => {},
      runScript: c.runScript,
      onPhase: c.onPhase,
    });
    expect(code).toBe(PR_FAILED_EXIT);
    assertOnce(c);
  });

  test("no-changes (NO_CHANGES_EXIT) → cleanup + teardown each run once", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc docs" },
      "git diff --name-only origin/main...HEAD": { stdout: "openspec/changes/x/tasks.md" },
      "gh pr list": { stdout: "" },
      "git cherry main HEAD": { stdout: "+ abc" },
      "git log --name-only --pretty=format: main..HEAD": {
        stdout: "openspec/changes/x/tasks.md\nopenspec/changes/x/proposal.md",
      },
    });
    const c = counters();
    const code = await runPostTask(
      baseInput({
        cfg: {
          teardownScript: "echo done",
          prBaseBranch: "main",
          autoMergeStrategy: "squash",
          cleanupWorktreeOnSuccess: false,
          stackPrsOnDependencies: false,
          neverTouch: [],
          metaOnlyFiles: ["openspec/**", "**/tasks.md"],
          finalizeNoOpAsDone: true,
        },
      }),
      { cmd, git, log: () => {}, runScript: c.runScript, onPhase: c.onPhase },
    );
    expect(code).toBe(NO_CHANGES_EXIT);
    assertOnce(c);
  });

  test("validate-only pass → cleanup + teardown each run once", async () => {
    const { cmd } = makeCmd({});
    const c = counters();
    const code = await runPostTask(baseInput({ wantValidateOnly: true, wantPr: false }), {
      cmd,
      git,
      log: () => {},
      runScript: c.runScript,
      onPhase: c.onPhase,
    });
    expect(code).toBe(0);
    assertOnce(c);
  });

  test("validate-only fail → cleanup + teardown each run once", async () => {
    const { cmd } = makeCmd({});
    const c = counters();
    const code = await runPostTask(
      baseInput({
        wantValidateOnly: true,
        wantPr: false,
        cfg: {
          teardownScript: "echo done",
          prBaseBranch: "main",
          autoMergeStrategy: "squash",
          cleanupWorktreeOnSuccess: false,
          stackPrsOnDependencies: false,
          neverTouch: [],
          validateCommands: ["exit 1"],
        },
        // The validate fix path respawns the worker; make it report failure.
        respawnWorker: async () => 1,
      }),
      { cmd, git, log: () => {}, runScript: c.runScript, onPhase: c.onPhase },
    );
    expect(code).toBe(1);
    assertOnce(c);
  });

  test("conflict-fix verify success → cleanup + teardown each run once", async () => {
    const { cmd } = makeCmd({
      "gh pr list": { stdout: "https://github.com/owner/repo/pull/42\n" },
      "gh pr view": { stdout: JSON.stringify({ state: "OPEN", mergeable: "MERGEABLE" }) },
      "git rev-list --count": { stdout: "0" },
    });
    const c = counters();
    const code = await runPostTask(baseInput({ mode: "conflict-fix" }), {
      cmd,
      git,
      log: () => {},
      runScript: c.runScript,
      onPhase: c.onPhase,
    });
    expect(code).toBe(0);
    assertOnce(c);
  });

  test("conflict-fix unpushed divergence → cleanup + teardown each run once (PR_FAILED_EXIT)", async () => {
    const { cmd } = makeCmd({
      "gh pr list": { stdout: "https://github.com/owner/repo/pull/42\n" },
      "gh pr view": { stdout: JSON.stringify({ state: "OPEN", mergeable: "CONFLICTING" }) },
      "git rev-list --count": { stdout: "2" },
    });
    const c = counters();
    const code = await runPostTask(baseInput({ mode: "conflict-fix" }), {
      cmd,
      git,
      log: () => {},
      runScript: c.runScript,
      onPhase: c.onPhase,
    });
    expect(code).toBe(PR_FAILED_EXIT);
    assertOnce(c);
  });

  test("thrown error mid-flow → cleanup + teardown still each run once", async () => {
    const { cmd } = makeCmd({});
    const c = counters();
    const boom = new Error("respawn blew up");
    await expect(
      runPostTask(
        baseInput({
          wantValidateOnly: true,
          wantPr: false,
          respawnWorker: async () => {
            throw boom;
          },
        }),
        { cmd, git, log: () => {}, runScript: c.runScript, onPhase: c.onPhase },
      ),
    ).rejects.toThrow("respawn blew up");
    assertOnce(c);
  });
});
