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
} from "../agent/post-task";
import { createGhCliCodeHost } from "@ralphy/codehost";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";
import type { TrackedIssue } from "@ralphy/tracker";

/**
 * RLF-255 9a: the PR phase now issues `markReady` / `enableAutoMerge` through
 * an injected `CodeHost`. Build it from the same scripted `cmd` runner each
 * test already uses, so the recorded `gh pr ready` / `gh pr merge --auto`
 * transitions stay assertable on the runner's call log.
 */
const ghHost = (cmd: CmdRunner) => createGhCliCodeHost({ cmdRunner: cmd, cwd: "/wt" });

const FAKE_ISSUE: TrackedIssue = {
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
      },
      {
        cmd,
        codeHost: ghHost(cmd),
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
        wantAutoMerge: false,
        cfg: {
          teardownScript: null,
          prBaseBranch: "main",
          autoMergeStrategy: "squash" as const,
          cleanupWorktreeOnSuccess: false,
          stackPrsOnDependencies: false,
          neverTouch: [],
        },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
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

  test("marks done as soon as the PR opens — no in-worker CI poll or conflict check (RLF-97)", async () => {
    const prUrl = "https://github.com/owner/repo/pull/99";

    // push succeeds, PR is created. The worker must NOT poll CI or probe for
    // conflicts — recovery is the scheduler watcher's job now.
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline": { stdout: "abc1234 some work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
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
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        git,
        log: () => {},
        runScript: async () => {},
        onPhase: (p) => phases.push(p),
      },
    );

    // The PR opens and the worker immediately reaches "done".
    expect(phases).toContain("done");
    // No in-worker recovery: `gh pr checks` (CI poll) is never invoked.
    expect(calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "checks")).toBeUndefined();
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
    cleanupWorktreeOnSuccess: false,
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

    const issue: TrackedIssue = { ...FAKE_ISSUE, labels: ["ralph:branch:release/2026"] };

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      { cmd, codeHost: ghHost(cmd), log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
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
        wantAutoMerge: true,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: (p) => phases.push(p),
        respawnWorker: async () => 0,
      },
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
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      { cmd, codeHost: ghHost(cmd), log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
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
        wantAutoMerge: true,
        cfg: baseCfg,
      },
      { cmd, codeHost: ghHost(cmd), log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
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
        wantAutoMerge: false,
        cfg: { ...baseCfg, stackPrsOnDependencies: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        resolveDependencyBaseBranch: async () => ({
          baseBranch: "feature/blocker",
          prUrl: "https://github.com/owner/repo/pull/123",
          prNumber: 123,
          blockerIdentifier: "RLF-7",
        }),
      },
    );

    expect(code).toBe(0);
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("feature/blocker");
    // The PR body names the dependency: which ticket and which PR.
    const body = createCall[createCall.indexOf("--body") + 1] ?? "";
    expect(body).toContain("Stacked on #123");
    expect(body).toContain("RLF-7");
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
    const issue: TrackedIssue = { ...FAKE_ISSUE, labels: ["ralph:branch:release/x"] };

    await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue,
        wantAutoMerge: false,
        cfg: { ...baseCfg, stackPrsOnDependencies: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        resolveDependencyBaseBranch: async () => {
          resolverCalled = true;
          return {
            baseBranch: "feature/blocker",
            prUrl: "https://github.com/owner/repo/pull/123",
            prNumber: 123,
            blockerIdentifier: "RLF-7",
          };
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
        wantAutoMerge: false,
        cfg: { ...baseCfg, stackPrsOnDependencies: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
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
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseCfg = {
    teardownScript: null,
    prBaseBranch: "main",
    autoMergeStrategy: "squash" as const,
    cleanupWorktreeOnSuccess: false,
    stackPrsOnDependencies: false,
    neverTouch: [],
  };

  test("when allow_auto_merge=false, skips --auto and leaves the PR for manual merge (RLF-97)", async () => {
    // The worker no longer polls CI in-process, so it can't merge a repo with
    // auto-merge disabled "once checks pass" — it logs and leaves the PR open.
    const prUrl = "https://github.com/owner/disabled/pull/5";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh api repos/owner/disabled": { stdout: "false\n" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: true,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    // No in-worker merge of any kind — neither --auto nor manual.
    expect(calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge")).toBeUndefined();
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
        wantAutoMerge: true,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: true },
      },
      { cmd, codeHost: ghHost(cmd), log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);
    const mergeCalls = calls.filter((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge");
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]).toContain("--auto");
    expect(mergeCalls[0]).toContain("--squash");
  });

  test("when allow_auto_merge=false and flag disabled, also leaves the PR un-merged (no merge call)", async () => {
    const prUrl = "https://github.com/owner/optout/pull/9";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh api repos/owner/optout": { stdout: "false\n" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: true,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: false },
      },
      { cmd, codeHost: ghHost(cmd), log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);
    // The flag now only changes the log message; no merge is attempted either way.
    expect(calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge")).toBeUndefined();
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
        wantAutoMerge: false,
        cfg: { ...baseCfg, manualMergeWhenAutoMergeDisabled: true },
      },
      { cmd, codeHost: ghHost(cmd), log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(calls.find((c) => c[0] === "gh" && c[1] === "api")).toBeUndefined();
    expect(calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge")).toBeUndefined();
  });
});

describe("runPrPhase — prDraft behavior", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-prdraft-"));
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
    cleanupWorktreeOnSuccess: false,
    stackPrsOnDependencies: false,
    neverTouch: [],
  };

  test("prDraft=true calls gh pr ready after CI passes", async () => {
    const prUrl = "https://github.com/owner/repo/pull/200";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr ready": { stdout: "" },
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
        wantAutoMerge: false,
        cfg: { ...baseCfg, prDraft: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: (p) => phases.push(p),
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall).toBeDefined();
    expect(createCall).toContain("--draft");
    const readyCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "ready");
    expect(readyCall).toBeDefined();
    expect(readyCall).toContain(prUrl);
    expect(phases).toContain("pr-ready");
  });

  test("prDraft=true + wantAutoMerge: gh pr ready first, then enables --auto (RLF-97)", async () => {
    const prUrl = "https://github.com/owner/repo/pull/201";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      // no `gh api` mock → repo auto-merge capability is unknown (null) → use --auto
      "gh pr ready": { stdout: "" },
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
        wantAutoMerge: true,
        cfg: { ...baseCfg, prDraft: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: (p, d) => phases.push(d ? `${p}:${d}` : p),
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    // gh pr ready runs first, THEN gh pr merge --auto (GitHub waits for CI).
    const readyIdx = calls.findIndex((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "ready");
    const mergeIdx = calls.findIndex((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "merge");
    expect(readyIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(readyIdx);
    expect(calls[mergeIdx]).toContain("--auto");
    expect(phases).toContain("auto-merge-enabled:squash");
  });

  test("prDraft=false has no gh pr ready call", async () => {
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
        wantAutoMerge: false,
        cfg: { ...baseCfg, prDraft: false },
      },
      { cmd, codeHost: ghHost(cmd), log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "ready")).toBeUndefined();
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall).not.toContain("--draft");
  });

  test("gh pr ready failure logs warning and skips auto-merge", async () => {
    const prUrl = "https://github.com/owner/repo/pull/203";
    const { cmd, calls } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr ready": { throw: true, stderr: "pr ready failed" },
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
        wantAutoMerge: true,
        cfg: { ...baseCfg, prDraft: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: (text, color) => logged.push({ text, color }),
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    const warnLine = logged.find(
      (l) => l.color === "yellow" && l.text.includes("gh pr ready failed"),
    );
    expect(warnLine).toBeDefined();
    // auto-merge should be skipped after pr ready failure.
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
    cleanupWorktreeOnSuccess: false,
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

    const phases: Array<{ p: string; d?: string | undefined }> = [];
    let respawnCalls = 0;
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
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
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
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
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => {
          respawnCalls += 1;
          return 0;
        },
      },
    );

    expect(code).toBe(71); // PR_FAILED_EXIT after ceiling
    // The only-meta reapply budget is the fixed MAX_PR_CREATE_ATTEMPTS (5):
    // 5 successful respawns, then the 6th block trips the ceiling.
    expect(respawnCalls).toBe(5);
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
    cleanupWorktreeOnSuccess: false,
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
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
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
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
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

// Regression: LIT-303 incident. Worker exited with edits still uncommitted,
// so `git log <base>..HEAD` showed no commits ahead and `createPullRequest`
// returned null. The phase silently returned 0, the parent loop posted a
// Linear completion comment and flipped the issue to "In Review", and the
// real diff was stranded in the worktree with no PR.
describe("runPrPhase — dirty worktree with no commits ahead must not return success", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-stranded-"));
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
    cleanupWorktreeOnSuccess: false,
    stackPrsOnDependencies: false,
    neverTouch: [],
  };

  // bug_case (post-fix): regression guard. Before the fix, runPrPhase returned 0
  // here, which caused the caller to post a Linear completion comment and mark
  // the issue done with no PR. The phase must now refuse to report success.
  test("bug_case (regression guard): never returns 0 when worktree is dirty and no commits ahead", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": {
        stdout:
          " M apps/game-astro/src/components/character/post-json.ts\n" +
          " M libs/jobs/src/types.ts\n",
      },
      "git log --oneline main..HEAD": { stdout: "" },
      "gh pr list": { stdout: "" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    // Post-fix: phase must never silently succeed when work is stranded.
    expect(code).not.toBe(0);
  });

  // fix_case: asserts the CORRECT post-fix behavior. Reproduces LIT-303.
  test("fix_case: returns PR_FAILED_EXIT (71) when worktree is dirty and no commits ahead of base", async () => {
    const { cmd } = makeCmd({
      // 50+ uncommitted files left behind by the worker.
      "git status --porcelain": {
        stdout:
          " M apps/game-astro/src/components/character/post-json.ts\n" +
          " M libs/game-persistence/src/character/character-loader-types.ts\n" +
          " M libs/jobs/src/types.ts\n",
      },
      // No commits ahead of base — createPullRequest will return null.
      "git log --oneline main..HEAD": { stdout: "" },
      // No existing PR for this branch.
      "gh pr list": { stdout: "" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    // Must NOT report success — the caller would otherwise post the Linear
    // completion comment and mark the issue done without a PR.
    expect(code).toBe(71); // PR_FAILED_EXIT
  });

  // Confirms the legitimate clean+no-commits path still returns 0.
  test("clean worktree with no commits ahead is still a benign 0 (no-op task)", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "" },
      "gh pr list": { stdout: "" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
  });
});

// RLF-214: the additive `setPrReady` indicator is applied via the `onPrReady`
// dep at the PR-phase success point, EXCEPT on the immediate non-draft
// auto-merge path. These tests stub `onPrReady` across the truth table.
describe("runPrPhase — onPrReady (setPrReady) trigger", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-prready-"));
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
    cleanupWorktreeOnSuccess: false,
    stackPrsOnDependencies: false,
    neverTouch: [],
  };

  // Row 1: wantAutoMerge=false, prDraft=false → opened ready, left for human.
  test("row 1 — non-auto-merge, non-draft: onPrReady called with PR url", async () => {
    const prUrl = "https://github.com/owner/repo/pull/301";
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });
    const readyCalls: string[] = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: async (url) => {
          readyCalls.push(url);
        },
      },
    );
    expect(code).toBe(0);
    expect(readyCalls).toEqual([prUrl]);
  });

  // Row 2: wantAutoMerge=false, prDraft=true → draft → gh pr ready, left for human.
  test("row 2 — non-auto-merge, draft: onPrReady called", async () => {
    const prUrl = "https://github.com/owner/repo/pull/302";
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr ready": { stdout: "" },
    });
    const readyCalls: string[] = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: { ...baseCfg, prDraft: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: async (url) => {
          readyCalls.push(url);
        },
      },
    );
    expect(code).toBe(0);
    expect(readyCalls).toEqual([prUrl]);
  });

  // Row 3: wantAutoMerge=true, prDraft=true → draft → gh pr ready → Ralphy merges.
  test("row 3 — auto-merge, draft: onPrReady called before merge", async () => {
    const prUrl = "https://github.com/owner/repo/pull/303";
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr ready": { stdout: "" },
      "gh pr merge": { stdout: "" },
    });
    const readyCalls: string[] = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: true,
        cfg: { ...baseCfg, prDraft: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: async (url) => {
          readyCalls.push(url);
        },
      },
    );
    expect(code).toBe(0);
    expect(readyCalls).toEqual([prUrl]);
  });

  // Row 4: wantAutoMerge=true, prDraft=false → immediate auto-merge, never reviewable.
  test("row 4 — auto-merge, non-draft: onPrReady IS called (PR sits reviewable until CI passes)", async () => {
    // RLF-97: `--auto` no longer merges instantly (it waits for CI), so the PR
    // is reviewable in the meantime — setPrReady fires on every PR-open path.
    const prUrl = "https://github.com/owner/repo/pull/304";
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr merge": { stdout: "" },
    });
    const readyCalls: string[] = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: true,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: async (url) => {
          readyCalls.push(url);
        },
      },
    );
    expect(code).toBe(0);
    expect(readyCalls).toEqual([prUrl]);
  });

  // A PR-create failure returns early before the success point.
  test("PR creation failure returns PR_FAILED_EXIT — onPrReady NOT called", async () => {
    const { cmd } = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { throw: true }, // PR create fails → gaveUp → PR_FAILED_EXIT
    });
    const readyCalls: string[] = [];
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 1,
        onPrReady: async (url) => {
          readyCalls.push(url);
        },
      },
    );
    expect(code).toBe(71); // PR_FAILED_EXIT
    expect(readyCalls).toEqual([]);
  });
});
