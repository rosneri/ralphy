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

  test("createWorktree fetches origin and roots a new branch at origin/<base>", async () => {
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-1": { throw: true },
    });
    const handle = await createWorktree("/proj", "eng-1", "main", runner);
    const expected = join(expectedWtRoot("/proj"), "eng-1");
    expect(handle.cwd).toBe(expected);
    expect(handle.branch).toBe("ralph/eng-1");
    const fetchCall = calls.find((c) => c.args[0] === "fetch");
    expect(fetchCall?.args).toEqual(["fetch", "origin", "main"]);
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.args).toEqual([
      "worktree",
      "add",
      "-b",
      "ralph/eng-1",
      expected,
      "origin/main",
    ]);
  });

  test("createWorktree honors a non-default base branch", async () => {
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-9": { throw: true },
    });
    await createWorktree("/proj", "eng-9", "release/2026", runner);
    const expected = join(expectedWtRoot("/proj"), "eng-9");
    expect(calls.map((c) => c.args)).toEqual([
      ["worktree", "list", "--porcelain"],
      ["rev-parse", "--verify", "--quiet", "refs/heads/ralph/eng-9"],
      ["fetch", "origin", "release/2026"],
      ["worktree", "add", "-b", "ralph/eng-9", expected, "origin/release/2026"],
    ]);
  });

  test("createWorktree fails loudly when fetch fails (no silent fallback to HEAD)", async () => {
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-x": { throw: true },
      "fetch origin main": { throw: true },
    });
    await expect(createWorktree("/proj", "eng-x", "main", runner)).rejects.toThrow();
    // The worktree add must not run after a failed fetch.
    expect(calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")).toBeUndefined();
  });

  test("createWorktree reuses an existing branch without fetching or rebasing", async () => {
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-2": { stdout: "abc123" },
    });
    await createWorktree("/proj", "eng-2", "main", runner);
    const expected = join(expectedWtRoot("/proj"), "eng-2");
    expect(calls.find((c) => c.args[0] === "fetch")).toBeUndefined();
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")!;
    expect(addCall.args).toEqual(["worktree", "add", expected, "ralph/eng-2"]);
  });

  test("createWorktree reuses an existing worktree (no add call)", async () => {
    const path = join(expectedWtRoot("/proj"), "eng-3");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: `worktree ${path}\nbranch refs/heads/ralph/eng-3\n` },
    });
    const handle = await createWorktree("/proj", "eng-3", "main", runner);
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
    const handle = await createWorktree("/a/b", "x", "main", runner);
    expect(handle.cwd).toBe(join(homedir(), ".ralph", "b", "worktrees", "x"));
  });
});
