import { afterEach, describe, expect, test } from "bun:test";
import { basename, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdtemp, rm, stat } from "node:fs/promises";
import {
  createWorktree,
  removeWorktree,
  isWorktreeSafeToRemove,
  branchForChange,
  worktreesDir,
  installPrePushHook,
  PRE_PUSH_HOOK_SCRIPT,
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

// createWorktree writes the per-worktree pre-push hook to
// `~/.ralph/<basename>/worktrees/<change>/.ralph-hooks/pre-push`. To keep the
// unit tests hermetic we use a tmpdir-backed project path so the basename is
// unique per test, then clean up the resulting `~/.ralph/<basename>` tree.
const dirtyProjects: string[] = [];
async function uniqueProject(prefix: string): Promise<string> {
  const p = await mkdtemp(join(tmpdir(), `wt-${prefix}-`));
  dirtyProjects.push(p);
  return p;
}
afterEach(async () => {
  while (dirtyProjects.length) {
    const p = dirtyProjects.pop()!;
    await rm(join(homedir(), ".ralph", basename(p)), { recursive: true, force: true });
    await rm(p, { recursive: true, force: true });
  }
});

describe("worktree helpers", () => {
  test("worktreesDir lives at ~/.ralph/<project>/worktrees, outside the project tree", () => {
    expect(worktreesDir("/some/path/proj")).toBe(join(homedir(), ".ralph", "proj", "worktrees"));
  });

  test("branchForChange uses ralph/<name> convention", () => {
    expect(branchForChange("eng-42-dark-mode")).toBe("ralph/eng-42-dark-mode");
  });

  test("createWorktree fetches origin and roots a new branch at origin/<base>", async () => {
    const proj = await uniqueProject("fresh");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-1": { throw: true },
    });
    const handle = await createWorktree(proj, "eng-1", "main", runner);
    const expected = join(expectedWtRoot(proj), "eng-1");
    expect(handle.cwd).toBe(expected);
    expect(handle.branch).toBe("ralph/eng-1");
    // Freshly provisioned worktree → created=true so setup runs once.
    expect(handle.created).toBe(true);
    const fetchCall = calls.find((c) => c.args[0] === "fetch");
    expect(fetchCall?.args).toEqual(["fetch", "origin", "main"]);
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")!;
    expect(addCall.args).toEqual(["worktree", "add", "-b", "ralph/eng-1", expected, "origin/main"]);
    // Hook install: config call uses the worktree cwd, not the projectRoot.
    const configCall = calls.find((c) => c.args[0] === "config")!;
    expect(configCall.args).toEqual(["config", "core.hooksPath", ".ralph-hooks"]);
    expect(configCall.cwd).toBe(expected);
    const hookPath = join(expected, ".ralph-hooks", "pre-push");
    const st = await stat(hookPath);
    expect(st.isFile()).toBe(true);
    // executable bit on owner
    expect((st.mode & 0o100) !== 0).toBe(true);
    expect(await Bun.file(hookPath).text()).toBe(PRE_PUSH_HOOK_SCRIPT);
  });

  test("createWorktree honors a non-default base branch", async () => {
    const proj = await uniqueProject("base");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-9": { throw: true },
    });
    await createWorktree(proj, "eng-9", "release/2026", runner);
    const expected = join(expectedWtRoot(proj), "eng-9");
    expect(calls.map((c) => c.args)).toEqual([
      ["worktree", "list", "--porcelain"],
      ["rev-parse", "--verify", "--quiet", "refs/heads/ralph/eng-9"],
      ["fetch", "origin", "release/2026"],
      ["worktree", "add", "-b", "ralph/eng-9", expected, "origin/release/2026"],
      ["config", "core.hooksPath", ".ralph-hooks"],
    ]);
  });

  test("createWorktree fails loudly when fetch fails (no silent fallback to HEAD)", async () => {
    const proj = await uniqueProject("fetch-fail");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-x": { throw: true },
      "fetch origin main": { throw: true },
    });
    await expect(createWorktree(proj, "eng-x", "main", runner)).rejects.toThrow();
    // The worktree add must not run after a failed fetch.
    expect(calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")).toBeUndefined();
    // Hook install must not happen either when create fails.
    expect(calls.find((c) => c.args[0] === "config")).toBeUndefined();
  });

  test("createWorktree reuses an existing branch and still installs the hook", async () => {
    const proj = await uniqueProject("reuse-branch");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/eng-2": { stdout: "abc123" },
    });
    const handle = await createWorktree(proj, "eng-2", "main", runner);
    const expected = join(expectedWtRoot(proj), "eng-2");
    // A new worktree directory is checked out onto the existing branch →
    // created=true (deps must be installed in the new working copy).
    expect(handle.created).toBe(true);
    expect(calls.find((c) => c.args[0] === "fetch")).toBeUndefined();
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")!;
    expect(addCall.args).toEqual(["worktree", "add", expected, "ralph/eng-2"]);
    const configCall = calls.find((c) => c.args[0] === "config")!;
    expect(configCall.args).toEqual(["config", "core.hooksPath", ".ralph-hooks"]);
    expect(configCall.cwd).toBe(expected);
    const st = await stat(join(expected, ".ralph-hooks", "pre-push"));
    expect(st.isFile()).toBe(true);
  });

  test("createWorktree reuses an existing worktree and still upgrades the hook", async () => {
    const proj = await uniqueProject("reuse-wt");
    const path = join(expectedWtRoot(proj), "eng-3");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: `worktree ${path}\nbranch refs/heads/ralph/eng-3\n` },
    });
    const handle = await createWorktree(proj, "eng-3", "main", runner);
    expect(handle.cwd).toBe(path);
    // Existing worktree directory reused (resume) → created=false so the
    // setup script is NOT re-run on this prepare.
    expect(handle.created).toBe(false);
    // No add, no rev-parse — but the hook install must still happen.
    expect(calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")).toBeUndefined();
    expect(calls.find((c) => c.args[0] === "rev-parse")).toBeUndefined();
    const configCall = calls.find((c) => c.args[0] === "config")!;
    expect(configCall.args).toEqual(["config", "core.hooksPath", ".ralph-hooks"]);
    expect(configCall.cwd).toBe(path);
    const st = await stat(join(path, ".ralph-hooks", "pre-push"));
    expect(st.isFile()).toBe(true);
  });

  // Regression: a worktree directory can be wiped out-of-band (manual `rm -rf`,
  // an interrupted op, OS temp cleanup) while git still lists the registration.
  // `git worktree list --porcelain` then flags that entry `prunable`. Reusing it
  // ran git commands inside a directory with no `.git` link → "fatal: not in a
  // git directory", which errored the issue. Provisioning must self-heal.
  const STALE_PORCELAIN = (path: string) =>
    `worktree ${path}\nHEAD abc123\nbranch refs/heads/ralph/eng-stale\nprunable gitdir file points to non-existent location\n`;

  test("self-heals a stale (prunable) registration: prunes then recreates", async () => {
    const proj = await uniqueProject("stale-fix");
    const path = join(expectedWtRoot(proj), "eng-stale");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": { stdout: STALE_PORCELAIN(path) },
      "rev-parse --verify --quiet refs/heads/ralph/eng-stale": { stdout: "abc123" },
    });
    const handle = await createWorktree(proj, "eng-stale", "main", runner);
    const order = calls.map((c) => c.args.join(" "));
    // The dead entry is pruned before the path/branch is re-claimed.
    expect(order).toContain("worktree prune");
    const addIdx = order.findIndex((a) => a.startsWith("worktree add"));
    expect(addIdx).toBeGreaterThan(-1);
    expect(order.indexOf("worktree prune")).toBeLessThan(addIdx);
    // Re-added onto the surviving branch (no fetch — branch still exists).
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")!;
    expect(addCall.args).toEqual(["worktree", "add", path, "ralph/eng-stale"]);
    expect(calls.find((c) => c.args[0] === "fetch")).toBeUndefined();
    // Fresh checkout → created=true so one-time setup re-runs.
    expect(handle.created).toBe(true);
    // Hook installed into the recreated worktree.
    const configCall = calls.find((c) => c.args[0] === "config")!;
    expect(configCall.cwd).toBe(path);
  });

  test("does NOT prune or re-add a live (non-prunable) worktree — plain resume", async () => {
    const proj = await uniqueProject("live-resume");
    const path = join(expectedWtRoot(proj), "eng-live");
    const { runner, calls } = makeRunner({
      "worktree list --porcelain": {
        stdout: `worktree ${path}\nHEAD abc123\nbranch refs/heads/ralph/eng-live\n`,
      },
    });
    const handle = await createWorktree(proj, "eng-live", "main", runner);
    // A healthy registration is reused as-is: no prune, no re-add, created=false.
    expect(handle.created).toBe(false);
    expect(calls.find((c) => c.args[0] === "worktree" && c.args[1] === "prune")).toBeUndefined();
    expect(calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")).toBeUndefined();
  });

  test("createWorktree serializes concurrent provisioning for the same repo", async () => {
    // Regression: the coordinator prepares queued issues concurrently. Without
    // a per-repo lock, parallel createWorktree calls run git against the same
    // `.git` at once and contend on its on-disk locks. Assert that two
    // concurrent calls for one projectRoot never overlap their git commands.
    const proj = await uniqueProject("serial");
    let active = 0;
    let maxActive = 0;
    const runner: GitRunner = {
      run: async (args) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        // Force the fresh-branch path (fetch + worktree add) for both calls.
        if (args[0] === "rev-parse") throw new Error("no such branch");
        return { stdout: "", stderr: "" };
      },
    };
    await Promise.all([
      createWorktree(proj, "eng-a", "main", runner),
      createWorktree(proj, "eng-b", "main", runner),
    ]);
    expect(maxActive).toBe(1);
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
    const proj = await uniqueProject("crossplat");
    const { runner } = makeRunner({
      "worktree list --porcelain": { stdout: "" },
      "rev-parse --verify --quiet refs/heads/ralph/x": { throw: true },
    });
    const handle = await createWorktree(proj, "x", "main", runner);
    expect(handle.cwd).toBe(join(homedir(), ".ralph", basename(proj), "worktrees", "x"));
  });

  describe("installPrePushHook (direct)", () => {
    test("writes the canonical script, marks it executable, and points hooksPath", async () => {
      const dir = await mkdtemp(join(tmpdir(), "wt-hook-"));
      try {
        const { runner, calls } = makeRunner();
        await installPrePushHook(dir, runner);
        const hookPath = join(dir, ".ralph-hooks", "pre-push");
        const st = await stat(hookPath);
        expect(st.isFile()).toBe(true);
        expect((st.mode & 0o100) !== 0).toBe(true);
        expect(await Bun.file(hookPath).text()).toBe(PRE_PUSH_HOOK_SCRIPT);
        expect(calls).toEqual([{ args: ["config", "core.hooksPath", ".ralph-hooks"], cwd: dir }]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
