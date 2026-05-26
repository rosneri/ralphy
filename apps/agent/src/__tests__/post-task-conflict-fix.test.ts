import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPostTask } from "../agent/post-task";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";
import type { LinearIssue } from "../agent/linear";

const FAKE_ISSUE: LinearIssue = {
  id: "issue-1",
  identifier: "RLF-169",
  title: "Conflict-fix via runPrPhase",
  url: "https://linear.app/team/issue/RLF-169",
  description: "",
  priority: 2,
  createdAt: "2026-05-26T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

interface MakeCmdOpts {
  /** Whether git log returns commits (default: true — has commits to PR). */
  hasCommits?: boolean;
  /** URL returned by gh pr list --head (existing open PR). */
  existingPrUrl?: string;
}

function makeCmd(opts: MakeCmdOpts = {}): { cmd: CmdRunner; calls: string[][] } {
  const hasCommits = opts.hasCommits ?? true;
  const existingPrUrl = opts.existingPrUrl ?? "https://github.com/owner/repo/pull/42";
  const calls: string[][] = [];

  const cmd: CmdRunner = {
    run: async (args) => {
      calls.push([...args]);

      // git log --oneline main..HEAD --no-merges
      if (args[0] === "git" && args[1] === "log" && args[2] === "--oneline") {
        return { stdout: hasCommits ? "abc123 Resolve merge conflicts\n" : "", stderr: "" };
      }

      // gh pr list --head <branch> --state open ... (find existing PR)
      if (args[0] === "gh" && args[1] === "pr" && args[2] === "list" && args.includes("--head")) {
        return { stdout: existingPrUrl, stderr: "" };
      }

      // git diff --name-only (for meta-only and never_touch checks)
      if (args[0] === "git" && args[1] === "diff" && args[2] === "--name-only") {
        return { stdout: "", stderr: "" };
      }

      // Default: success with empty output
      return { stdout: "", stderr: "" };
    },
  };
  return { cmd, calls };
}

describe("runPostTask — conflict-fix flows through runPrPhase", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-conflict-fix-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "active", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseInput = (
    overrides: Partial<{ mode: "conflict-fix" | "fresh"; exitCode: number }> = {},
  ) => ({
    mode: (overrides.mode ?? "conflict-fix") as "conflict-fix" | "fresh",
    changeName: "my-change",
    cwd: tmpDir,
    projectRoot: tmpDir,
    changeDir,
    stateFilePath,
    branch: "ralph/my-change",
    issue: FAKE_ISSUE,
    exitCode: overrides.exitCode ?? 0,
    useWorktree: false,
    wantPr: true,
    wantFixCi: false,
    wantAutoMerge: false,
    cfg: {
      teardownScript: null,
      prBaseBranch: "main",
      autoMergeStrategy: "squash" as const,
      maxCiFixAttempts: 3,
      ciPollIntervalSeconds: 0,
      cleanupWorktreeOnSuccess: false,
      ignoreCiChecks: [],
      stackPrsOnDependencies: false,
      neverTouch: [],
    },
    respawnWorker: async () => 0,
  });

  const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

  test("conflict-fix success: git push is called, existing PR surfaced, clearConflicted invoked", async () => {
    const { cmd, calls } = makeCmd();
    const clearConflicted = mock(async () => {});

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
      clearConflicted,
    });

    expect(code).toBe(0);
    // Must push the branch (via createPullRequest)
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(true);
    // Must NOT create a new PR (existing one found)
    expect(calls.some((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")).toBe(false);
    // clearConflicted must be called once after runPrPhase returns 0
    expect(clearConflicted).toHaveBeenCalledTimes(1);
  });

  test("worker exits non-zero: PR phase skipped, no push, no clearConflicted", async () => {
    const { cmd, calls } = makeCmd();
    const clearConflicted = mock(async () => {});

    const code = await runPostTask(baseInput({ exitCode: 1 }), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
      clearConflicted,
    });

    expect(code).toBe(1);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    expect(clearConflicted).toHaveBeenCalledTimes(0);
  });

  test("no commits ahead of base: runPrPhase skips PR, clearConflicted still called", async () => {
    // When createPullRequest returns null (no commits ahead of base), runPrPhase
    // returns 0 (worker resolved everything and commits were rebased away).
    // clearConflicted is still called because runPrPhase returned 0 — the PR
    // is effectively clean regardless of whether a new push was needed.
    const { cmd, calls } = makeCmd({ hasCommits: false });
    const clearConflicted = mock(async () => {});

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
      clearConflicted,
    });

    expect(code).toBe(0);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    expect(clearConflicted).toHaveBeenCalledTimes(1);
  });

  test("fresh mode: clearConflicted NOT called even on success", async () => {
    const { cmd } = makeCmd();
    const clearConflicted = mock(async () => {});

    await runPostTask(baseInput({ mode: "fresh" }), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
      clearConflicted,
    });

    // clearConflicted is only for conflict-fix mode
    expect(clearConflicted).toHaveBeenCalledTimes(0);
  });
});
