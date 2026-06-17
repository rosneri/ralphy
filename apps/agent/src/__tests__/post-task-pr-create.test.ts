import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AGENT_TASKS_FILENAME } from "@ralphy/core/tasks-md";
import { createPrWithRetry } from "../agent/post-task/pr-create";
import type { PostTaskCtx } from "../agent/post-task/types";
import type { CmdRunner } from "../agent/pr";
import { createFakeCodeHost } from "@ralphy/codehost/testing";
import type { TrackedIssue } from "@ralphy/tracker";

const FAKE_ISSUE: TrackedIssue = {
  id: "issue-1",
  identifier: "RLF-PR-CREATE",
  title: "PR create retry",
  url: "https://linear.app/team/issue/RLF-PR-CREATE",
  description: "",
  priority: 2,
  createdAt: "2026-06-13T00:00:00.000Z",
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
            const err = new Error("cmd failed") as Error & { stderr?: string; stdout?: string };
            err.stderr = r.stderr ?? "";
            err.stdout = r.stdout ?? "";
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

describe("createPrWithRetry", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-pr-create-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(stateFilePath, JSON.stringify({ status: "completed" }, null, 2));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(
    cmd: CmdRunner,
    respawnWorker: () => Promise<number>,
    codeHostOverrides?: Partial<PostTaskCtx["codeHost"]>,
  ): PostTaskCtx {
    const codeHost = { ...createFakeCodeHost(), ...codeHostOverrides };
    return {
      changeName: "my-change",
      cwd: tmpDir,
      branch: "ralph/my-change",
      base: "main",
      changeDir,
      stateFilePath,
      cfg: {
        teardownScript: null,
        prBaseBranch: "main",
        autoMergeStrategy: "squash",
        cleanupWorktreeOnSuccess: false,
        stackPrsOnDependencies: false,
        neverTouch: [],
      },
      cmd,
      log: () => {},
      emit: () => {},
      respawnWorker,
      codeHost,
    };
  }

  // Always-present so createPullRequest proceeds to the push (commits ahead +
  // a stable HEAD so the append-only guard never trips on respawn).
  const HEAD_OK: CmdSpec[] = [
    { match: "git log --oneline main..HEAD", replies: [{ stdout: "abc work" }] },
    { match: "git rev-parse HEAD", replies: [{ stdout: "samehead" }] },
  ];

  test("push-rejection retry budget: gives up after MAX_PR_CREATE_ATTEMPTS fix attempts", async () => {
    const { cmd, calls } = makeScriptedCmd([
      ...HEAD_OK,
      // Every push is rejected by the pre-push hook.
      {
        match: "git push -u origin",
        replies: [{ throw: true, stderr: "failed to push some refs to origin" }],
      },
    ]);
    let respawns = 0;
    const result = await createPrWithRetry(
      makeCtx(cmd, async () => {
        respawns += 1;
        return 0;
      }),
      FAKE_ISSUE,
    );
    expect(result.gaveUp).toBe(true);
    expect(result.pr).toBeNull();
    // 5 fix attempts respawn the worker; the 6th push trips the ceiling.
    expect(respawns).toBe(5);
    const pushes = calls.filter((c) => c[0] === "git" && c[1] === "push");
    expect(pushes).toHaveLength(6);
  });

  test("non-fast-forward push: merges origin then succeeds on the retry", async () => {
    const prUrl = "https://github.com/owner/repo/pull/9";
    const fetchCalls: string[] = [];
    const pullCalls: string[] = [];
    const { cmd, calls } = makeScriptedCmd([
      ...HEAD_OK,
      // First push rejected non-ff, second push succeeds.
      {
        match: "git push -u origin",
        replies: [
          { throw: true, stderr: "Updates were rejected because the remote contains work" },
          { stdout: "" },
        ],
      },
      { match: "gh pr list", replies: [{ stdout: "" }] },
      { match: "gh pr create", replies: [{ stdout: prUrl }] },
    ]);
    let respawns = 0;
    const result = await createPrWithRetry(
      makeCtx(
        cmd,
        async () => {
          respawns += 1;
          return 0;
        },
        {
          fetchBranch: async (branch) => {
            fetchCalls.push(branch);
          },
          pullBranch: async (branch) => {
            pullCalls.push(branch);
          },
        },
      ),
      FAKE_ISSUE,
    );
    expect(result.gaveUp).toBe(false);
    expect(result.pr?.url).toBe(prUrl);
    // The non-ff path merges (no rebase) and never respawns the worker.
    expect(respawns).toBe(0);
    expect(fetchCalls).toHaveLength(1);
    expect(pullCalls).toHaveLength(1);
    // Append-only: never force-push.
    expect(calls.some((c) => c[1] === "push" && c.includes("--force"))).toBe(false);
  });

  test("non-ff merge produces conflicts: aborts, prepends a Resolve-merge-conflict fix task, retries", async () => {
    const prUrl = "https://github.com/owner/repo/pull/10";
    let abortMergeCalls = 0;
    const { cmd } = makeScriptedCmd([
      ...HEAD_OK,
      {
        match: "git push -u origin",
        replies: [
          { throw: true, stderr: "Updates were rejected because the remote contains work" },
          { stdout: "" },
        ],
      },
      { match: "gh pr list", replies: [{ stdout: "" }] },
      { match: "gh pr create", replies: [{ stdout: prUrl }] },
    ]);
    let respawns = 0;
    const result = await createPrWithRetry(
      makeCtx(
        cmd,
        async () => {
          respawns += 1;
          return 0;
        },
        {
          fetchBranch: async () => {},
          pullBranch: async () => {
            const err = new Error("Merge failed") as Error & { stdout?: string };
            err.stdout = "CONFLICT (content): Merge conflict in src/a.ts";
            throw err;
          },
          abortMerge: async () => {
            abortMergeCalls += 1;
          },
          changedFiles: async () => ["src/a.ts"],
        },
      ),
      FAKE_ISSUE,
    );
    expect(result.gaveUp).toBe(false);
    expect(result.pr?.url).toBe(prUrl);
    // Conflict path aborts the merge and respawns exactly once to resolve.
    expect(abortMergeCalls).toBe(1);
    expect(respawns).toBe(1);
    const tasks = await Bun.file(join(changeDir, AGENT_TASKS_FILENAME)).text();
    expect(tasks).toContain("Resolve merge conflict with origin/ralph/my-change");
  });

  test("non-PR-create error (not a push rejection) gives up immediately without respawning", async () => {
    const { cmd } = makeScriptedCmd([
      ...HEAD_OK,
      { match: "git push -u origin", replies: [{ stdout: "" }] },
      { match: "gh pr list", replies: [{ stdout: "" }] },
      { match: "gh pr create", replies: [{ throw: true, stderr: "gh: validation failed" }] },
    ]);
    let respawns = 0;
    const result = await createPrWithRetry(
      makeCtx(cmd, async () => {
        respawns += 1;
        return 0;
      }),
      FAKE_ISSUE,
    );
    expect(result.gaveUp).toBe(true);
    expect(respawns).toBe(0);
  });
});
