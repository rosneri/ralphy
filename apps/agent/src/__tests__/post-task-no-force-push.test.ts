import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPrPhase } from "../agent/post-task";
import type { CmdRunner } from "../agent/pr";
import type { LinearIssue } from "../agent/linear";

const FAKE_ISSUE: LinearIssue = {
  id: "issue-1",
  identifier: "RLF-NO-FORCE",
  title: "No force-push integration",
  url: "https://linear.app/team/issue/RLF-NO-FORCE",
  description: "",
  priority: 2,
  createdAt: "2026-05-27T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

type Reply = { stdout?: string; stderr?: string; throw?: boolean };

interface CmdSpec {
  /** Prefix on `args.join(" ")`. Longest match wins. */
  match: string;
  /** Sequential replies; once exhausted the last entry repeats. */
  replies: Reply[];
}

function makeScriptedCmd(specs: CmdSpec[]): { cmd: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const idxByMatch = new Map<string, number>();
  // Sort longest match first so "git push -u origin" beats "git push".
  const ordered = [...specs].sort((a, b) => b.match.length - a.match.length);

  const cmd: CmdRunner = {
    run: async (args) => {
      calls.push([...args]);
      const key = args.join(" ");
      for (const s of ordered) {
        if (key.startsWith(s.match)) {
          const i = idxByMatch.get(s.match) ?? 0;
          idxByMatch.set(s.match, i + 1);
          const r = s.replies[Math.min(i, s.replies.length - 1)] ?? {};
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

/**
 * Hard safety property: across every scenario in this suite, the agent must
 * never invoke a force push and must never run a real rebase. The only legal
 * mention of "rebase" is the explicit `--no-rebase` flag we pass to `git pull`.
 */
function assertNoForceOrRebase(calls: string[][]): void {
  for (const c of calls) {
    expect(c).not.toContain("--force");
    expect(c).not.toContain("--force-with-lease");
    expect(c).not.toContain("rebase");
    expect(c).not.toContain("--rebase");
  }
}

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

describe("runPrPhase — non-fast-forward push never force-pushes, always merges", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-no-force-"));
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

  test("non-FF push → fetch + pull --no-rebase --no-edit → retry push succeeds", async () => {
    const { cmd, calls } = makeScriptedCmd([
      { match: "git status --porcelain", replies: [{ stdout: "" }] },
      { match: "git log --oneline main..HEAD", replies: [{ stdout: "abc work" }] },
      {
        match: "git push -u origin",
        replies: [
          { throw: true, stderr: "! [rejected]  ralph/my-change (non-fast-forward)" },
          { stdout: "" },
        ],
      },
      { match: "git fetch origin", replies: [{ stdout: "" }] },
      { match: "git pull --no-rebase", replies: [{ stdout: "" }] },
      { match: "gh pr list", replies: [{ stdout: "" }] },
      {
        match: "gh pr create",
        replies: [{ stdout: "https://github.com/owner/repo/pull/1" }],
      },
    ]);

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
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(0);

    // The merge path ran — not the rebase path.
    const pullCall = calls.find((c) => c[0] === "git" && c[1] === "pull");
    expect(pullCall).toBeDefined();
    expect(pullCall).toContain("--no-rebase");
    expect(pullCall).toContain("--no-edit");
    expect(pullCall).toContain("--autostash");

    // Push happened twice (initial reject + retry after merge).
    const pushCalls = calls.filter((c) => c[0] === "git" && c[1] === "push");
    expect(pushCalls.length).toBe(2);

    assertNoForceOrRebase(calls);
  });

  test("non-FF push → pull --no-rebase produces conflicts → merge --abort + fix worker → retry succeeds", async () => {
    let respawnCount = 0;
    const { cmd, calls } = makeScriptedCmd([
      { match: "git status --porcelain", replies: [{ stdout: "" }] },
      { match: "git log --oneline main..HEAD", replies: [{ stdout: "abc work" }] },
      {
        match: "git push -u origin",
        replies: [
          { throw: true, stderr: "! [rejected]  ralph/my-change (non-fast-forward)" },
          { stdout: "" },
        ],
      },
      { match: "git fetch origin", replies: [{ stdout: "" }] },
      {
        match: "git pull --no-rebase",
        replies: [
          {
            throw: true,
            stderr: "CONFLICT (content): Merge conflict in foo.ts\nAutomatic merge failed",
          },
        ],
      },
      { match: "git merge --abort", replies: [{ stdout: "" }] },
      { match: "git diff --name-only", replies: [{ stdout: "foo.ts\nbar.ts" }] },
      { match: "gh pr list", replies: [{ stdout: "" }] },
      {
        match: "gh pr create",
        replies: [{ stdout: "https://github.com/owner/repo/pull/2" }],
      },
    ]);

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
        emit: () => {},
        respawnWorker: async () => {
          respawnCount += 1;
          return 0;
        },
      },
    );

    expect(code).toBe(0);
    expect(respawnCount).toBe(1); // worker spawned exactly once to resolve the conflict

    // Aborted via merge, never via rebase.
    expect(calls.some((c) => c[0] === "git" && c[1] === "merge" && c[2] === "--abort")).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c[1] === "rebase")).toBe(false);

    // The conflict-resolution prompt prepended to tasks.md must instruct
    // the worker to merge, not rebase, and not amend or force-push.
    const agentTasksMd = await Bun.file(join(changeDir, "agent-tasks.md")).text();
    expect(agentTasksMd).toContain("git merge origin/ralph/my-change");
    expect(agentTasksMd.toLowerCase()).toContain("do not rebase");
    expect(agentTasksMd).not.toContain("git rebase --continue");
    expect(agentTasksMd).not.toContain("--force-with-lease");
    expect(agentTasksMd).not.toContain("git commit --amend");

    assertNoForceOrRebase(calls);
  });

  test("non-FF push → pull --no-rebase fails with non-conflict error → gives up cleanly, never force-pushes", async () => {
    const { cmd, calls } = makeScriptedCmd([
      { match: "git status --porcelain", replies: [{ stdout: "" }] },
      { match: "git log --oneline main..HEAD", replies: [{ stdout: "abc work" }] },
      {
        match: "git push -u origin",
        replies: [{ throw: true, stderr: "! [rejected]  (non-fast-forward)" }],
      },
      { match: "git fetch origin", replies: [{ stdout: "" }] },
      {
        match: "git pull --no-rebase",
        replies: [{ throw: true, stderr: "fatal: unable to access 'origin': network unreachable" }],
      },
    ]);

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
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(71); // PR_FAILED_EXIT — we gave up rather than forcing.
    // No second push attempt; no `--force` / `--force-with-lease` ever.
    const pushCalls = calls.filter((c) => c[0] === "git" && c[1] === "push");
    expect(pushCalls.length).toBe(1);
    assertNoForceOrRebase(calls);
  });

  test("non-FF push → repeated conflicts exhaust attempts → gives up, never force-pushes", async () => {
    // maxAttempts inside post-task.ts is 3. Drive 3 rounds of conflict.
    const conflictReply: Reply = {
      throw: true,
      stderr: "CONFLICT (content): Merge conflict in foo.ts",
    };
    const { cmd, calls } = makeScriptedCmd([
      { match: "git status --porcelain", replies: [{ stdout: "" }] },
      { match: "git log --oneline main..HEAD", replies: [{ stdout: "abc work" }] },
      {
        match: "git push -u origin",
        replies: [
          // Every push attempt is rejected as non-FF; we never reach a success.
          { throw: true, stderr: "! [rejected]  (non-fast-forward)" },
        ],
      },
      { match: "git fetch origin", replies: [{ stdout: "" }] },
      {
        match: "git pull --no-rebase",
        // Every merge attempt conflicts.
        replies: [conflictReply],
      },
      { match: "git merge --abort", replies: [{ stdout: "" }] },
      { match: "git diff --name-only", replies: [{ stdout: "foo.ts" }] },
    ]);

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
      { cmd, log: () => {}, emit: () => {}, respawnWorker: async () => 0 },
    );

    expect(code).toBe(71); // PR_FAILED_EXIT
    assertNoForceOrRebase(calls);
  });
});
