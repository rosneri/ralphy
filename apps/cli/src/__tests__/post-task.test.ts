import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPostTask } from "../agent/post-task";
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
  blockedByIds: [],
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
        cfg: {
          teardownScript: null,
          prBaseBranch: "main",
          maxCiFixAttempts: 3,
          ciPollIntervalSeconds: 0,
          cleanupWorktreeOnSuccess: false,
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
