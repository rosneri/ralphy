import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AGENT_TASKS_FILENAME } from "@ralphy/core/tasks-md";
import { reactivateState, runWorkerWithFixTask } from "../agent/post-task/respawn";
import type { PostTaskCtx } from "../agent/post-task/types";
import type { CmdRunner } from "../agent/pr";
import { createFakeCodeHost } from "@ralphy/codehost/testing";

// The respawn tier is the inner fix-and-retry authority (distinct from
// loopMachine). Its two invariants under test:
//   1. reactivateState flips a non-active state back to "active" so the
//      re-spawned worker reads the freshly-prepended fix task.
//   2. runWorkerWithFixTask refuses to accept a respawn that rewrote history
//      (pre-HEAD must be an ancestor of post-HEAD) — the guard against a fix
//      worker "fixing" a failure by reverting/amending its own commits.

const noop: CmdRunner = { run: async () => ({ stdout: "", stderr: "" }) };

describe("reactivateState", () => {
  let tmpDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-respawn-state-"));
    stateFilePath = join(tmpDir, ".ralph-state.json");
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("flips a completed state back to active", async () => {
    await Bun.write(stateFilePath, JSON.stringify({ status: "completed" }, null, 2));
    await reactivateState(stateFilePath, () => {}, "my-change");
    const after = JSON.parse(await Bun.file(stateFilePath).text());
    expect(after.status).toBe("active");
    expect(after.lastModified).toBeDefined();
  });

  test("leaves an already-active state untouched (no rewrite)", async () => {
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "active", lastModified: "2026-01-01T00:00:00.000Z" }, null, 2),
    );
    await reactivateState(stateFilePath, () => {}, "my-change");
    const after = JSON.parse(await Bun.file(stateFilePath).text());
    expect(after.status).toBe("active");
    expect(after.lastModified).toBe("2026-01-01T00:00:00.000Z");
  });

  test("missing state file is a no-op", async () => {
    // Should not throw when the file does not exist.
    await reactivateState(join(tmpDir, "nope.json"), () => {}, "my-change");
  });
});

describe("runWorkerWithFixTask", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-respawn-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(stateFilePath, JSON.stringify({ status: "completed" }, null, 2));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(
    respawnWorker: () => Promise<number>,
    log: (text: string, color?: string) => void = () => {},
    codeHostOverride?: Partial<PostTaskCtx["codeHost"]>,
  ): PostTaskCtx {
    const codeHost = { ...createFakeCodeHost(), ...codeHostOverride };
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
      cmd: noop,
      log,
      emit: () => {},
      respawnWorker,
      codeHost,
    };
  }

  test("prepends the fix task, reactivates state, and returns the respawn code", async () => {
    // unchanged HEAD: headSha returns same value before and after — no ancestor check needed
    let respawns = 0;
    const code = await runWorkerWithFixTask(
      makeCtx(async () => {
        respawns += 1;
        return 0;
      }),
      "Fix something",
      "failure detail body",
    );
    expect(code).toBe(0);
    expect(respawns).toBe(1);
    // Fix task landed in the agent tasks file.
    const tasks = await Bun.file(join(changeDir, AGENT_TASKS_FILENAME)).text();
    expect(tasks).toContain("Fix something");
    expect(tasks).toContain("failure detail body");
    // State reactivated.
    const state = JSON.parse(await Bun.file(stateFilePath).text());
    expect(state.status).toBe("active");
  });

  test("returns 1 and logs a red error when the respawn rewrote history", async () => {
    // Different pre/post HEAD, ancestor check returns false → history rewrite detected.
    let headCallCount = 0;
    const logs: { text: string; color?: string }[] = [];
    const code = await runWorkerWithFixTask(
      makeCtx(
        async () => 0,
        (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
        {
          headSha: async () => (headCallCount++ === 0 ? "preHEAD0" : "postHEAD9"),
          isAncestor: async () => false,
        },
      ),
      "Fix push rejection",
      "body",
    );
    expect(code).toBe(1);
    expect(logs.some((l) => l.color === "red" && /rewrote history/.test(l.text))).toBe(true);
  });

  test("accepts a respawn whose new HEAD is a descendant (append-only)", async () => {
    // Different pre/post HEAD, ancestor check returns true → append-only verified.
    let headCallCount = 0;
    const isAncestorCalls: unknown[][] = [];
    const code = await runWorkerWithFixTask(
      makeCtx(
        async () => 0,
        () => {},
        {
          headSha: async () => (headCallCount++ === 0 ? "preHEAD0" : "postHEAD9"),
          isAncestor: async (ancestor, descendant, cwd) => {
            isAncestorCalls.push([ancestor, descendant, cwd]);
            return true;
          },
        },
      ),
      "Fix",
      "body",
    );
    expect(code).toBe(0);
    // The ancestor check actually ran (HEAD changed → must verify).
    expect(isAncestorCalls.length).toBe(1);
  });

  test("returns 1 without respawning when the fix task cannot be prepended", async () => {
    // Point changeDir at a path whose tasks file can't be written (parent is a
    // file, not a directory) so prependTask throws.
    const badFile = join(tmpDir, "not-a-dir");
    await Bun.write(badFile, "x");
    const ctx = makeCtx(async () => 0);
    ctx.changeDir = join(badFile, "nested");
    let respawns = 0;
    const code = await runWorkerWithFixTask(
      {
        ...ctx,
        respawnWorker: async () => {
          respawns += 1;
          return 0;
        },
      },
      "Fix",
      "body",
    );
    expect(code).toBe(1);
    expect(respawns).toBe(0);
  });
});
