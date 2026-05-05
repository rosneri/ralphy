import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createWorktree,
  removeWorktree,
  isWorktreeSafeToRemove,
  branchForChange,
  worktreesDir,
  type GitRunner,
} from "../agent/worktree";

interface RecordedCall {
  args: string[];
  cwd: string;
}

function makeRunner(
  responses: Record<string, { stdout?: string; stderr?: string; throw?: boolean }> = {},
): { runner: GitRunner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runner: GitRunner = {
    run: async (args, cwd) => {
      calls.push({ args, cwd });
      const key = args.join(" ");
      const r = responses[key];
      if (r?.throw) {
        throw new Error("git failed");
      }
      return { stdout: r?.stdout ?? "", stderr: r?.stderr ?? "" };
    },
  };
  return { runner, calls };
}

describe("worktree helpers", () => {
  test("worktreesDir is rooted under .ralph/worktrees", () => {
    expect(worktreesDir("/proj")).toBe("/proj/.ralph/worktrees");
  });

  test("branchForChange uses ralph/<name> convention", () => {
    expect(branchForChange("eng-42-dark-mode")).toBe("ralph/eng-42-dark-mode");
  });

  test("createWorktree creates a new branch + worktree when neither exists", async () => {
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-1": { throw: true },
    });
    const handle = await createWorktree("/proj", "eng-1", runner);
    expect(handle.cwd).toBe("/proj/.ralph/worktrees/eng-1");
    expect(handle.branch).toBe("ralph/eng-1");
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.args).toEqual([
      "worktree",
      "add",
      "-b",
      "ralph/eng-1",
      "/proj/.ralph/worktrees/eng-1",
    ]);
  });

  test("createWorktree reuses an existing branch (no -b)", async () => {
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-2": { stdout: "abc123" },
    });
    await createWorktree("/proj", "eng-2", runner);
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")!;
    expect(addCall.args).toEqual([
      "worktree",
      "add",
      "/proj/.ralph/worktrees/eng-2",
      "ralph/eng-2",
    ]);
  });

  test("createWorktree reuses an existing worktree (no add call)", async () => {
    const path = "/proj/.ralph/worktrees/eng-3";
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: `worktree ${path}\nbranch refs/heads/ralph/eng-3\n` },
    });
    const handle = await createWorktree("/proj", "eng-3", runner);
    expect(handle.cwd).toBe(path);
    // Only the list call should have happened — no add, no rev-parse.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["worktree", "list", "--porcelain"]);
  });

  test("removeWorktree shells out to git worktree remove --force", async () => {
    const { runner, calls } = makeRunner();
    await removeWorktree("/proj", "/proj/.ralph/worktrees/eng-4", runner);
    expect(calls).toEqual([
      {
        args: ["worktree", "remove", "--force", "/proj/.ralph/worktrees/eng-4"],
        cwd: "/proj",
      },
    ]);
  });

  describe("isWorktreeSafeToRemove", () => {
    test("safe when working tree is clean and no commits ahead of base", async () => {
      const { runner } = makeRunner({
        "status --porcelain": { stdout: "" },
        "log --oneline main..HEAD --no-merges": { stdout: "" },
      });
      const check = await isWorktreeSafeToRemove("/wt", "main", runner);
      expect(check.safe).toBe(true);
      expect(check.dirty).toBe("");
      expect(check.unpushedCommits).toBe("");
    });

    test("unsafe when there are uncommitted changes (the silent-loss case)", async () => {
      const { runner } = makeRunner({
        "status --porcelain": { stdout: " M apps/cli/src/foo.ts\n?? scratch.md" },
        "log --oneline main..HEAD --no-merges": { stdout: "" },
      });
      const check = await isWorktreeSafeToRemove("/wt", "main", runner);
      expect(check.safe).toBe(false);
      expect(check.reason).toMatch(/uncommitted/i);
      expect(check.dirty).toContain("scratch.md");
    });

    test("unsafe when there are commits ahead of base but tree is clean", async () => {
      const { runner } = makeRunner({
        "status --porcelain": { stdout: "" },
        "log --oneline main..HEAD --no-merges": { stdout: "abc1234 feat: thing" },
      });
      const check = await isWorktreeSafeToRemove("/wt", "main", runner);
      expect(check.safe).toBe(false);
      expect(check.reason).toMatch(/commits ahead/i);
      expect(check.unpushedCommits).toContain("abc1234");
    });

    test("unsafe when both dirty and ahead of base", async () => {
      const { runner } = makeRunner({
        "status --porcelain": { stdout: " M foo" },
        "log --oneline main..HEAD --no-merges": { stdout: "abc feat" },
      });
      const check = await isWorktreeSafeToRemove("/wt", "main", runner);
      expect(check.safe).toBe(false);
      expect(check.reason).toMatch(/uncommitted.*unpushed|both/i);
    });

    test("unsafe when git log fails (treat unknown as unsafe)", async () => {
      const { runner } = makeRunner({
        "status --porcelain": { stdout: "" },
        "log --oneline main..HEAD --no-merges": { throw: true },
      });
      const check = await isWorktreeSafeToRemove("/wt", "main", runner);
      expect(check.safe).toBe(false);
      expect(check.unpushedCommits).toMatch(/unknown/i);
    });
  });

  test("createWorktree path uses join (cross-platform)", async () => {
    const { runner } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/x": { throw: true },
    });
    const handle = await createWorktree("/a/b", "x", runner);
    expect(handle.cwd).toBe(join("/a/b", ".ralph", "worktrees", "x"));
  });
});
