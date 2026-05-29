import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";

type SpawnResult = { exitCode: number; stdout: string; stderr: string };

const spawnCalls: { cmd: string[] }[] = [];
let nextSpawnResults: SpawnResult[] = [];
let defaultSpawnResult: SpawnResult = { exitCode: 0, stdout: "", stderr: "" };

const originalSpawnSync = Bun.spawnSync.bind(Bun);
const encoder = new TextEncoder();

Object.assign(Bun, {
  spawnSync: (options: { cmd: string[] }) => {
    spawnCalls.push({ cmd: options.cmd });
    const result = nextSpawnResults.shift() ?? defaultSpawnResult;
    return {
      exitCode: result.exitCode,
      success: result.exitCode === 0,
      stdout: encoder.encode(result.stdout),
      stderr: encoder.encode(result.stderr),
      pid: 0,
      signalCode: null,
      resourceUsage: undefined,
    };
  },
});

const {
  getCurrentBranch,
  gitAdd,
  gitCommit,
  gitPush,
  commitState,
  commitTaskDir,
  getUncommittedFiles,
} = await import("../git");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "git-test-"));
  spawnCalls.length = 0;
  nextSpawnResults = [];
  defaultSpawnResult = { exitCode: 0, stdout: "", stderr: "" };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("getCurrentBranch", () => {
  test("returns trimmed branch name from git", () => {
    nextSpawnResults = [{ exitCode: 0, stdout: "feature/my-branch\n", stderr: "" }];
    const branch = getCurrentBranch();
    expect(branch).toBe("feature/my-branch");
    expect(spawnCalls[0]!.cmd).toEqual(["git", "branch", "--show-current"]);
  });

  test("returns 'main' when git command fails", () => {
    nextSpawnResults = [{ exitCode: 1, stdout: "", stderr: "not a git repo" }];
    expect(getCurrentBranch()).toBe("main");
  });

  test("returns 'main' when branch output is empty", () => {
    nextSpawnResults = [{ exitCode: 0, stdout: "\n", stderr: "" }];
    expect(getCurrentBranch()).toBe("main");
  });
});

describe("gitAdd", () => {
  test("invokes git add with file paths", () => {
    gitAdd(["file1.ts", "file2.ts"]);
    expect(spawnCalls[0]!.cmd).toEqual(["git", "add", "file1.ts", "file2.ts"]);
  });

  test("handles a single file", () => {
    gitAdd(["src/index.ts"]);
    expect(spawnCalls[0]!.cmd).toEqual(["git", "add", "src/index.ts"]);
  });

  test("throws when git add fails", () => {
    nextSpawnResults = [{ exitCode: 1, stdout: "", stderr: "fatal" }];
    expect(() => gitAdd(["nope.ts"])).toThrow("git add failed");
  });
});

describe("gitCommit", () => {
  test("invokes git commit with message", () => {
    gitCommit("fix: resolve issue");
    expect(spawnCalls[0]!.cmd).toEqual(["git", "commit", "-m", "fix: resolve issue"]);
  });

  test("passes message as argv (no shell escaping needed)", () => {
    gitCommit('add "feature"');
    expect(spawnCalls[0]!.cmd).toEqual(["git", "commit", "-m", 'add "feature"']);
  });

  test("throws when git commit fails", () => {
    nextSpawnResults = [{ exitCode: 1, stdout: "", stderr: "nothing to commit" }];
    expect(() => gitCommit("noop")).toThrow("git commit failed");
  });
});

describe("gitPush", () => {
  test("succeeds on first attempt", () => {
    nextSpawnResults = [
      { exitCode: 0, stdout: "main\n", stderr: "" }, // branch
      { exitCode: 0, stdout: "", stderr: "" }, // push
    ];
    gitPush();
    expect(spawnCalls.length).toBe(2);
  });

  test("falls back to push -u on first failure", () => {
    nextSpawnResults = [
      { exitCode: 0, stdout: "main\n", stderr: "" }, // branch
      { exitCode: 1, stdout: "", stderr: "no upstream" }, // push
      { exitCode: 0, stdout: "", stderr: "" }, // push -u
    ];
    gitPush();
    expect(spawnCalls[2]!.cmd).toEqual(["git", "push", "-u", "origin", "main"]);
  });

  test("falls back to --set-upstream on second failure", () => {
    nextSpawnResults = [
      { exitCode: 0, stdout: "dev\n", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "no upstream" },
      { exitCode: 1, stdout: "", stderr: "no upstream" },
      { exitCode: 0, stdout: "", stderr: "" },
    ];
    gitPush();
    expect(spawnCalls[3]!.cmd).toEqual(["git", "push", "--set-upstream", "origin", "dev"]);
  });

  test("silently skips when all push attempts fail", () => {
    defaultSpawnResult = { exitCode: 1, stdout: "", stderr: "no remote" };
    nextSpawnResults = [{ exitCode: 0, stdout: "main\n", stderr: "" }];
    // Should not throw
    expect(() => gitPush()).not.toThrow();
  });
});

describe("commitState", () => {
  test("adds and commits state.json", () => {
    commitState("/tasks/test", "phase transition");
    expect(spawnCalls[0]!.cmd).toEqual(["git", "add", "/tasks/test/state.json"]);
    expect(spawnCalls[1]!.cmd).toEqual(["git", "commit", "-m", "docs(ralph): phase transition"]);
  });

  test("silently handles failure", () => {
    defaultSpawnResult = { exitCode: 1, stdout: "", stderr: "nothing to commit" };
    expect(() => commitState("/tasks/test", "msg")).not.toThrow();
  });
});

describe("commitTaskDir", () => {
  test("adds task directory and commits with prefixed message", () => {
    commitTaskDir("/tasks/my-task", "save progress");
    expect(spawnCalls[0]!.cmd).toEqual(["git", "add", "/tasks/my-task"]);
    expect(spawnCalls[1]!.cmd).toEqual(["git", "commit", "-m", "docs(ralph): save progress"]);
  });

  test("silently handles failure", () => {
    defaultSpawnResult = { exitCode: 1, stdout: "", stderr: "nothing to commit" };
    expect(() => commitTaskDir("/tasks/test", "msg")).not.toThrow();
  });
});

describe("getUncommittedFiles", () => {
  test("returns list of uncommitted file paths from git status", () => {
    nextSpawnResults = [{ exitCode: 0, stdout: " M src/foo.ts\n?? src/bar.ts\n", stderr: "" }];
    expect(getUncommittedFiles()).toEqual([" M src/foo.ts", "?? src/bar.ts"]);
    expect(spawnCalls[0]!.cmd).toEqual(["git", "status", "--porcelain"]);
  });

  test("returns empty array when git status fails", () => {
    nextSpawnResults = [{ exitCode: 1, stdout: "", stderr: "not a git repo" }];
    expect(getUncommittedFiles()).toEqual([]);
  });
});

// Restore the original at the end (tests run sequentially within the module)
afterEach(() => {
  // no-op — we keep the patch for the whole module since it's reset in beforeEach
  void originalSpawnSync;
});
