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
  identifier: "RLF-82",
  title: "Conflict-fix verify",
  url: "https://linear.app/team/issue/RLF-82",
  description: "",
  priority: 2,
  createdAt: "2026-05-22T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

interface MakeCmdOpts {
  /** Value returned for `gh pr view --json ...`. Stringified inline. */
  prView?: { state?: string; mergeable?: string } | "fail";
  /** URL returned by `gh pr list --head ...`. */
  prListUrl?: string | "";
}

function makeCmd(opts: MakeCmdOpts): { cmd: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const cmd: CmdRunner = {
    run: async (args) => {
      calls.push([...args]);
      if (args[0] === "gh" && args[1] === "pr" && args[2] === "list") {
        return { stdout: opts.prListUrl ?? "", stderr: "" };
      }
      if (args[0] === "gh" && args[1] === "pr" && args[2] === "view") {
        if (opts.prView === "fail") {
          const err = new Error("gh failed") as Error & { stderr?: string };
          err.stderr = "auth required";
          throw err;
        }
        return { stdout: JSON.stringify(opts.prView ?? {}), stderr: "" };
      }
      // Any other git/gh call — pretend success with empty output. The
      // conflict-fix short-circuit must not hit `git push`, so if such a
      // call ever shows up the test's assertions will surface it.
      return { stdout: "", stderr: "" };
    },
  };
  return { cmd, calls };
}

describe("runPostTask — conflict-fix verify-only short-circuit", () => {
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

  const baseInput = (overrides: { mode?: "conflict-fix" | "fresh" } = {}) => ({
    mode: overrides.mode ?? ("conflict-fix" as const),
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

  test("MERGEABLE → clearConflicted invoked exactly once and runPostTask returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: { state: "OPEN", mergeable: "MERGEABLE" },
    });
    const clearConflicted = mock(async () => {});

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
      clearConflicted,
    });

    expect(code).toBe(0);
    expect(clearConflicted).toHaveBeenCalledTimes(1);
    // Must NOT push or open a PR.
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    expect(calls.some((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")).toBe(false);
  });

  test("CONFLICTING → clearConflicted NOT invoked, yellow log, returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: { state: "OPEN", mergeable: "CONFLICTING" },
    });
    const clearConflicted = mock(async () => {});
    const logs: { text: string; color?: string }[] = [];

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
      runScript: async () => {},
      clearConflicted,
    });

    expect(code).toBe(0);
    expect(clearConflicted).toHaveBeenCalledTimes(0);
    expect(
      logs.some((l) => l.color === "yellow" && /still CONFLICTING after rebase/.test(l.text)),
    ).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
  });

  test("UNKNOWN → clearConflicted NOT invoked, yellow log, returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: { state: "OPEN", mergeable: "UNKNOWN" },
    });
    const clearConflicted = mock(async () => {});
    const logs: { text: string; color?: string }[] = [];

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
      runScript: async () => {},
      clearConflicted,
    });

    expect(code).toBe(0);
    expect(clearConflicted).toHaveBeenCalledTimes(0);
    expect(logs.some((l) => l.color === "yellow" && /UNKNOWN/.test(l.text))).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
  });

  test("gh fetch error → clearConflicted NOT invoked, yellow log, returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: "fail",
    });
    const clearConflicted = mock(async () => {});
    const logs: { text: string; color?: string }[] = [];

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
      runScript: async () => {},
      clearConflicted,
    });

    expect(code).toBe(0);
    expect(clearConflicted).toHaveBeenCalledTimes(0);
    expect(logs.some((l) => l.color === "yellow" && /PR status fetch failed/.test(l.text))).toBe(
      true,
    );
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
  });

  test("non-conflict-fix mode does NOT take the short-circuit (legacy PR path engages)", async () => {
    // For mode!=conflict-fix the legacy `runPrPhase` is invoked. It will
    // begin by running `git status --porcelain` to inspect the worktree.
    // We don't drive the full flow here — we only assert the conflict-fix
    // verify path did NOT short-circuit (no `gh pr list --head` for verify)
    // and clearConflicted was not invoked.
    const { cmd, calls } = makeCmd({
      prView: { mergeable: "MERGEABLE" },
    });
    const clearConflicted = mock(async () => {});

    await runPostTask(baseInput({ mode: "fresh" }), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
      clearConflicted,
    });

    expect(clearConflicted).toHaveBeenCalledTimes(0);
    // The legacy path runs `git status --porcelain` as its first step;
    // the short-circuit path never does. Confirm we took the legacy path.
    expect(calls.some((c) => c[0] === "git" && c[1] === "status")).toBe(true);
  });
});
