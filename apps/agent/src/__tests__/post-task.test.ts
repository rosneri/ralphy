import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runPostTask,
  runPrPhase,
  runWorktreeCleanupPhase,
  runTeardownPhase,
  summarizeUncommittedStatus,
  _resetRepoAutoMergeCache,
} from "../agent/post-task";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";
import type { LinearIssue } from "../agent/linear";

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
  labels: [],
};

function makeCmd(
  responses: Record<string, { stdout?: string; stderr?: string; throw?: boolean }>,
): { cmd: CmdRunner; calls: string[][] } {
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

describe("runPostTask — CI fix reactivates state", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-test-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });

    // Write a tasks.md so prependFixTask has a file to work with.
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");

    // State file with status="completed" — simulates a worker that just finished.
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("state is reactivated before respawnWorker is called during CI fix", async () => {
    // CI: first check returns "fail", second check (after the fix respawn) returns "pass".
    let ciCallCount = 0;
    const prUrl = "https://github.com/owner/repo/pull/99";

    const { cmd } = makeCmd({
      // commit phase: nothing dirty
      "git status --porcelain": { stdout: "" },
      // PR create phase: branch has commits
      "git log --oneline": { stdout: "abc1234 some work" },
      // push
      "git push -u origin": { stdout: "" },
      // no existing PR
      "gh pr list": { stdout: "" },
      // PR create
      "gh pr create": { stdout: prUrl },
      // CI poll: fail once, pass once
      "gh pr checks": {
        get stdout() {
          ciCallCount += 1;
          if (ciCallCount === 1) {
            return JSON.stringify([
              {
                name: "CI",
                bucket: "fail",
                link: "https://github.com/owner/repo/actions/runs/42/job/7",
              },
            ]);
          }
          return JSON.stringify([{ name: "CI", bucket: "pass" }]);
        },
      },
      // failed run logs
      "gh run view": { stdout: "error: type mismatch in foo.ts" },
      // push after CI fix
      "git push origin": { stdout: "" },
    });

    // Capture the state file content at the moment respawnWorker is called.
    let stateAtRespawn: { status?: string } | null = null;
    const respawnWorker = async (): Promise<number> => {
      const text = await Bun.file(stateFilePath).text();
      stateAtRespawn = JSON.parse(text) as { status?: string };
      return 0;
    };

    const git: GitRunner = {
      run: async () => ({ stdout: "", stderr: "" }),
    };

    await runPostTask(
      {
        changeName: "my-change",
        cwd: tmpDir,
        projectRoot: tmpDir,
        changeDir,
        stateFilePath,
        branch: "ralph/my-change",
        issue: FAKE_ISSUE,
        exitCode: 0,
        useWorktree: false,
        wantPr: true,
        wantFixCi: true,
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
        respawnWorker,
      },
      {
        cmd,
        git,
        log: () => {},
        runScript: async () => {},
      },
    );

    expect(stateAtRespawn).not.toBeNull();
    expect(stateAtRespawn!.status).toBe("active");
  });
});

describe("runPostTask — teardown", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-teardown-test-"));
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

  test("teardown fires even when exitCode is non-zero", async () => {
    const phases: string[] = [];
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };
    const { cmd } = makeCmd({});

    await runPostTask(
      {
        changeName: "my-change",
        cwd: tmpDir,
        projectRoot: tmpDir,
        changeDir,
        stateFilePath,
        branch: "ralph/my-change",
        issue: FAKE_ISSUE,
        exitCode: 1,
        useWorktree: false,
        wantPr: false,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: {
          teardownScript: "echo done",
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
      },
      {
        cmd,
        git,
        log: () => {},
        runScript: async () => {},
        onPhase: (phase) => phases.push(phase),
      },
    );

    expect(phases).toContain("gave-up");
    expect(phases).toContain("teardown");
  });
});

// ---------------------------------------------------------------------------
// Phase isolation smoke tests
// ---------------------------------------------------------------------------

describe("runPrPhase — isolation", () => {
  test("returns PR_FAILED_EXIT when branch is null", async () => {
    const phases: string[] = [];
    const cmd: CmdRunner = { run: async () => ({ stdout: "", stderr: "" }) };

    const code = await runPrPhase(
      {
        changeName: "x",
        cwd: "/tmp",
        branch: null,
        changeDir: "/tmp/changes/x",
        stateFilePath: "/tmp/.ralph-state.json",
        issue: null,
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
      },
      {
        cmd,
        log: () => {},
        emit: (p) => phases.push(p),
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(71); // PR_FAILED_EXIT
    expect(phases).not.toContain("pr-create");
  });
});

describe("runWorktreeCleanupPhase — isolation", () => {
  test("is a no-op when useWorktree is false", async () => {
    const git: GitRunner = {
      run: async () => {
        throw new Error("git must not be called");
      },
    };
    const phases: string[] = [];

    await runWorktreeCleanupPhase(
      {
        changeName: "x",
        cwd: "/tmp/worktree",
        projectRoot: "/tmp",
        useWorktree: false,
        effectiveCode: 0,
        cfg: { cleanupWorktreeOnSuccess: true, prBaseBranch: "main" },
      },
      { git, log: () => {}, emit: (p) => phases.push(p) },
    );

    expect(phases).toHaveLength(0);
  });
});

describe("runTeardownPhase — isolation", () => {
  test("is a no-op when teardownScript is null", async () => {
    const phases: string[] = [];
    let scriptRan = false;

    await runTeardownPhase(
      { cwd: "/tmp", teardownScript: null },
      {
        runScript: async () => {
          scriptRan = true;
        },
        log: () => {},
        emit: (p) => phases.push(p),
      },
    );

    expect(scriptRan).toBe(false);
    expect(phases).toHaveLength(0);
  });
});

describe("runPostTask — conflict-check loop termination", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-conflict-loop-"));
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

  test("exits cleanly after CI green + conflict check passes (no infinite loop)", async () => {
    const prUrl = "https://github.com/owner/repo/pull/99";
    let conflictCheckCalls = 0;

    // Simulate: push succeeds, PR already exists, CI passes, no conflicts
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline": { stdout: "abc1234 some work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
    });

    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };
    const phases: string[] = [];

    await runPostTask(
      {
        changeName: "my-change",
        cwd: tmpDir,
        projectRoot: tmpDir,
        changeDir,
        stateFilePath,
        branch: "ralph/my-change",
        issue: FAKE_ISSUE,
        exitCode: 0,
        useWorktree: false,
        wantPr: true,
        wantFixCi: true,
        wantAutoMerge: false,
        cfg: {
          teardownScript: null,
          prBaseBranch: "main",
          autoMergeStrategy: "squash" as const,
          maxCiFixAttempts: 5,
          ciPollIntervalSeconds: 0,
          cleanupWorktreeOnSuccess: false,
          ignoreCiChecks: [],
          stackPrsOnDependencies: false,
          neverTouch: [],
        },
        respawnWorker: async () => 0,
      },
      {
        cmd,
        git,
        log: () => {},
        runScript: async () => {},
        onPhase: (p) => phases.push(p),
        checkPrConflict: async () => {
          conflictCheckCalls += 1;
          return false; // not conflicting (MERGEABLE)
        },
      },
    );

    // Should emit "done" and call conflict-check at most twice (once before CI,
    // once final scan after CI green) — not spin forever.
    expect(phases).toContain("done");
    expect(conflictCheckCalls).toBeLessThanOrEqual(2);
  });
});

describe("runPrPhase — base branch override + auto-merge", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-pr-flags-"));
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

  const baseCfg = {
    teardownScript: null,
    prBaseBranch: "main",
    autoMergeStrategy: "squash" as const,
    maxCiFixAttempts: 3,
    ciPollIntervalSeconds: 0,
    cleanupWorktreeOnSuccess: false,
    ignoreCiChecks: [],
    stackPrsOnDependencies: false,
    neverTouch: [],
  };

  test("ralph:branch:<name> label overrides cfg.prBaseBranch when creating the PR", async () => {
    const prUrl = "https://github.com/owner/repo/pull/77";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline release/2026..HEAD": { stdout: "abc some work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });

    const issue: LinearIssue = { ...FAKE_ISSUE, labels: ["ralph:branch:release/2026"] };

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall).toBeDefined();
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("release/2026");
    expect(
      calls.find((c) => c.join(" ").startsWith("git log --oneline main..HEAD")),
    ).toBeUndefined();
  });

  test("wantAutoMerge=true invokes gh pr merge --auto --squash right after PR creation", async () => {
    const prUrl = "https://github.com/owner/repo/pull/77";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc some work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr merge": { stdout: "" },
    });

    const phases: string[] = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: true,
        cfg: baseCfg,
      },
      { cmd, log: () => {}, emit: (p) => phases.push(p), respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);
    const mergeCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge")!;
    expect(mergeCall).toBeDefined();
    expect(mergeCall).toContain("--auto");
    expect(mergeCall).toContain("--squash");
    expect(mergeCall).toContain(prUrl);
    expect(phases).toContain("auto-merge-enabled");
  });

  test("wantAutoMerge=false does not call gh pr merge", async () => {
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc some work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/owner/repo/pull/1" },
    });

    await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge")).toBeUndefined();
  });

  test("auto-merge failure does not fail the phase", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc some work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/owner/repo/pull/2" },
      "gh pr merge": { throw: true, stderr: "auto-merge not allowed" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: true,
        cfg: baseCfg,
      },
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);
  });

  test("stackPrsOnDependencies uses resolver's branch when no label override", async () => {
    const prUrl = "https://github.com/owner/repo/pull/200";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline feature/blocker..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: { ...baseCfg, stackPrsOnDependencies: true },
      },
      {
        cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        resolveDependencyBaseBranch: async () => "feature/blocker",
      },
    );

    expect(code).toBe(0);
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("feature/blocker");
  });

  test("ralph:branch label still wins over stackPrsOnDependencies resolver", async () => {
    const prUrl = "https://github.com/owner/repo/pull/201";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline release/x..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });

    let resolverCalled = false;
    const issue: LinearIssue = { ...FAKE_ISSUE, labels: ["ralph:branch:release/x"] };

    await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: { ...baseCfg, stackPrsOnDependencies: true },
      },
      {
        cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        resolveDependencyBaseBranch: async () => {
          resolverCalled = true;
          return "feature/blocker";
        },
      },
    );

    expect(resolverCalled).toBe(false);
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("release/x");
  });

  test("stackPrsOnDependencies falls back to cfg.prBaseBranch when resolver returns null", async () => {
    const prUrl = "https://github.com/owner/repo/pull/202";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });

    await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: { ...baseCfg, stackPrsOnDependencies: true },
      },
      {
        cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        resolveDependencyBaseBranch: async () => null,
      },
    );

    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("main");
  });
});

describe("runPrPhase — manual-merge fallback when repo auto-merge is disabled", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-manual-merge-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
    );
    _resetRepoAutoMergeCache();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseCfg = {
    teardownScript: null,
    prBaseBranch: "main",
    autoMergeStrategy: "squash" as const,
    maxCiFixAttempts: 3,
    ciPollIntervalSeconds: 0,
    cleanupWorktreeOnSuccess: false,
    ignoreCiChecks: [],
    stackPrsOnDependencies: false,
    neverTouch: [],
  };

  test("when allow_auto_merge=false, skips --auto and merges manually after CI green", async () => {
    const prUrl = "https://github.com/owner/disabled/pull/5";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh api repos/owner/disabled": { stdout: "false\n" },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr merge": { stdout: "" },
    });

    const phases: string[] = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: true,
        wantAutoMerge: true,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: true },
      },
      {
        cmd,
        log: () => {},
        emit: (p, d) => phases.push(d ? `${p}:${d}` : p),
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    const mergeCalls = calls.filter((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge");
    // No --auto invocation should have been made.
    expect(mergeCalls.some((c) => c.includes("--auto"))).toBe(false);
    // One manual-merge call (no --auto) should have happened.
    const manual = mergeCalls.find((c) => !c.includes("--auto"));
    expect(manual).toBeDefined();
    expect(manual).toContain("--squash");
    expect(manual).toContain(prUrl);
    expect(phases).toContain("auto-merge-enabled:manual:squash");
  });

  test("when allow_auto_merge=true, uses native --auto and skips manual merge", async () => {
    const prUrl = "https://github.com/owner/enabled/pull/5";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh api repos/owner/enabled": { stdout: "true\n" },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr merge": { stdout: "" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: true,
        wantAutoMerge: true,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: true },
      },
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);
    const mergeCalls = calls.filter((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge");
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]).toContain("--auto");
    expect(mergeCalls[0]).toContain("--squash");
  });

  test("when allow_auto_merge=false but flag disabled, behaves like the old silent no-op", async () => {
    const prUrl = "https://github.com/owner/optout/pull/9";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh api repos/owner/optout": { stdout: "false\n" },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr merge": { throw: true, stderr: "auto-merge is not allowed for this repository" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: true,
        wantAutoMerge: true,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: false },
      },
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);
    const mergeCalls = calls.filter((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge");
    // Old behavior: a single --auto call that fails and is logged as a warning.
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]).toContain("--auto");
  });

  test("wantAutoMerge=false never queries repo capability or merges", async () => {
    const prUrl = "https://github.com/owner/nomerge/pull/1";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });

    await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: true },
      },
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(calls.find((c) => c[0] === "gh" && c[1] === "api")).toBeUndefined();
    expect(calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge")).toBeUndefined();
  });
});

describe("runPrPhase — only-meta diff guard", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-only-meta-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    await Bun.write(join(changeDir, "agent-tasks.md"), "## flow\n\n- [x] something\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseCfg = {
    teardownScript: null,
    prBaseBranch: "main",
    autoMergeStrategy: "squash" as const,
    maxCiFixAttempts: 2,
    ciPollIntervalSeconds: 0,
    cleanupWorktreeOnSuccess: false,
    ignoreCiChecks: [],
    stackPrsOnDependencies: false,
    neverTouch: [],
    metaOnlyFiles: ["openspec/**", "**/tasks.md", "**/agent-tasks.md"],
  };

  test("blocked: emits pr-only-meta, prepends fix task, respawns worker, and skips push when respawn returns non-zero", async () => {
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git diff --name-only origin/main...HEAD": {
        stdout: "openspec/changes/x/tasks.md\nopenspec/changes/x/agent-tasks.md\n",
      },
    });

    const phases: Array<{ p: string; d?: string }> = [];
    let respawnCalls = 0;
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        log: () => {},
        emit: (p, d) => phases.push({ p, d }),
        respawnWorker: async () => {
          respawnCalls += 1;
          return 1; // worker failed to recover → give up after this attempt
        },
      },
    );

    expect(code).toBe(71); // PR_FAILED_EXIT
    expect(respawnCalls).toBe(1);
    expect(phases.find((p) => p.p === "pr-only-meta")).toBeDefined();
    // Must not have pushed or called gh pr create.
    expect(calls.find((c) => c[0] === "git" && c[1] === "push")).toBeUndefined();
    expect(calls.find((c) => c[0] === "gh" && c[2] === "create")).toBeUndefined();

    // The fix task should now be in agent-tasks.md.
    const updated = await Bun.file(join(changeDir, "agent-tasks.md")).text();
    expect(updated).toContain("Reapply lost implementation files");
    expect(updated).toContain("openspec/changes/x/tasks.md");
  });

  test("recovery path: when respawn restores files, the next iteration's mixed diff opens the PR", async () => {
    let diffCallCount = 0;
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git diff --name-only origin/main...HEAD": {
        get stdout() {
          diffCallCount += 1;
          if (diffCallCount === 1) return "openspec/changes/x/tasks.md\n";
          return "openspec/changes/x/tasks.md\nsrc/feature.ts\n";
        },
      },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/42" },
    });

    const phases: string[] = [];
    let respawnCalls = 0;
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        log: () => {},
        emit: (p) => phases.push(p),
        respawnWorker: async () => {
          respawnCalls += 1;
          return 0;
        },
      },
    );

    expect(code).toBe(0);
    expect(respawnCalls).toBe(1);
    expect(phases).toContain("pr-only-meta");
    expect(calls.find((c) => c[0] === "gh" && c[2] === "create")).toBeDefined();
  });

  test("respects maxOuterAttempts ceiling: repeated meta-only blocks eventually return PR_FAILED_EXIT", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git diff --name-only origin/main...HEAD": { stdout: "openspec/changes/x/tasks.md\n" },
    });

    let respawnCalls = 0;
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: { ...baseCfg, maxCiFixAttempts: 2 },
      },
      {
        cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => {
          respawnCalls += 1;
          return 0;
        },
      },
    );

    expect(code).toBe(71); // PR_FAILED_EXIT after ceiling
    // maxCiFixAttempts=2 → 2 successful respawns, then the 3rd block trips the ceiling.
    expect(respawnCalls).toBe(2);
  });
});

describe("summarizeUncommittedStatus", () => {
  test("returns count 0 for empty input", () => {
    expect(summarizeUncommittedStatus("")).toEqual({ count: 0, preview: [], truncated: 0 });
    expect(summarizeUncommittedStatus("\n")).toEqual({ count: 0, preview: [], truncated: 0 });
  });

  test("returns the verbatim porcelain lines when ≤10", () => {
    const stdout = " M src/a.ts\n?? scratch.log\n";
    const result = summarizeUncommittedStatus(stdout);
    expect(result.count).toBe(2);
    expect(result.preview).toEqual([" M src/a.ts", "?? scratch.log"]);
    expect(result.truncated).toBe(0);
  });

  test("truncates to 10 entries with the remainder reported", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `?? file-${i}.ts`).join("\n");
    const result = summarizeUncommittedStatus(lines);
    expect(result.count).toBe(12);
    expect(result.preview).toHaveLength(10);
    expect(result.truncated).toBe(2);
    expect(result.preview[0]).toBe("?? file-0.ts");
    expect(result.preview[9]).toBe("?? file-9.ts");
  });
});

describe("runPrPhase — uncommitted-changes log behavior", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-dirty-"));
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

  const baseCfg = {
    teardownScript: null,
    prBaseBranch: "main",
    autoMergeStrategy: "squash" as const,
    maxCiFixAttempts: 3,
    ciPollIntervalSeconds: 0,
    cleanupWorktreeOnSuccess: false,
    ignoreCiChecks: [],
    stackPrsOnDependencies: false,
    neverTouch: [],
  };

  test("dirty + existing PR logs gray informational line with file list, no yellow warning", async () => {
    const prUrl = "https://github.com/owner/repo/pull/55";
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: " M src/a.ts\n?? scratch.log\n" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      // first `gh pr list` (uncommitted-status branch) AND second (createPullRequest) both return existing URL.
      "gh pr list": { stdout: prUrl },
    });

    const logged: Array<{ text: string; color?: string | undefined }> = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        log: (text, color) => logged.push({ text, color }),
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    const grayLine = logged.find((l) => l.color === "gray" && l.text.includes("uncommitted file"));
    expect(grayLine).toBeDefined();
    expect(grayLine!.text).toContain(" M src/a.ts");
    expect(grayLine!.text).toContain("?? scratch.log");
    expect(grayLine!.text).toContain("will retry next iteration");
    expect(
      logged.find(
        (l) => l.color === "yellow" && l.text.includes("has uncommitted changes after worker exit"),
      ),
    ).toBeUndefined();
  });

  test("dirty + no existing PR logs yellow warning with file list", async () => {
    const prUrl = "https://github.com/owner/repo/pull/56";
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "?? scratch.log\n" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      // gh pr list returns empty — no existing PR.
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });

    const logged: Array<{ text: string; color?: string | undefined }> = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantFixCi: false,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        log: (text, color) => logged.push({ text, color }),
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    const yellowLine = logged.find(
      (l) => l.color === "yellow" && l.text.includes("has uncommitted changes after worker exit"),
    );
    expect(yellowLine).toBeDefined();
    expect(yellowLine!.text).toContain("?? scratch.log");
  });
});
