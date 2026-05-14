import { describe, expect, test } from "bun:test";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import {
  createWorktree,
  removeWorktree,
  isWorktreeSafeToRemove,
  branchForChange,
  worktreesDir,
  type GitRunner,
} from "../agent/worktree";

const expectedWtRoot = (project: string) =>
  join(homedir(), ".ralph", basename(project), "worktrees");

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
  test("worktreesDir lives at ~/.ralph/<project>/worktrees, outside the project tree", () => {
    expect(worktreesDir("/some/path/proj")).toBe(join(homedir(), ".ralph", "proj", "worktrees"));
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
    const expected = join(expectedWtRoot("/proj"), "eng-1");
    expect(handle.cwd).toBe(expected);
    expect(handle.branch).toBe("ralph/eng-1");
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.args).toEqual(["worktree", "add", "-b", "ralph/eng-1", expected]);
  });

  test("createWorktree reuses an existing branch (no -b)", async () => {
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-2": { stdout: "abc123" },
    });
    await createWorktree("/proj", "eng-2", runner);
    const expected = join(expectedWtRoot("/proj"), "eng-2");
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")!;
    expect(addCall.args).toEqual(["worktree", "add", expected, "ralph/eng-2"]);
  });

  test("createWorktree reuses an existing worktree (no add call)", async () => {
    const path = join(expectedWtRoot("/proj"), "eng-3");
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
    const path = join(expectedWtRoot("/proj"), "eng-4");
    await removeWorktree("/proj", path, runner);
    expect(calls).toEqual([
      {
        args: ["worktree", "remove", "--force", path],
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
        "status --porcelain": { stdout: " M apps/loop/src/foo.ts\n?? scratch.md" },
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
    expect(handle.cwd).toBe(join(homedir(), ".ralph", "b", "worktrees", "x"));
  });
});
