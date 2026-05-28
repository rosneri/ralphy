import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "@ralphy/events";
import { runCapability } from "../run-capability";
import { git } from "../git";
import type { GitRunner } from "../../../agent/worktree";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "git-cap-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("git capability", () => {
  test("createWorktree is required and rethrows on failure (no fallback handle)", async () => {
    const runner: GitRunner = {
      run: async () => {
        throw new Error("boom");
      },
    };
    expect(git.createWorktree.required).toBe(true);
    let captured: unknown;
    let result: unknown;
    try {
      result = await runCapability(git.createWorktree, {
        projectRoot: root,
        changeName: "eng-1",
        baseBranch: "main",
        runner,
      });
    } catch (err) {
      captured = err;
    }
    expect(result).toBeUndefined();
    expect((captured as Error).message).toBe("boom");
  });

  test("createWorktree emits started + failed when the runner throws", async () => {
    const bus = createBus();
    const events: string[] = [];
    bus.on("*", (e) => {
      events.push(e.type as string);
    });
    const runner: GitRunner = {
      run: async () => {
        throw new Error("nope");
      },
    };
    await runCapability(
      git.createWorktree,
      { projectRoot: root, changeName: "eng-2", baseBranch: "main", runner },
      { bus },
    ).catch(() => {});
    expect(events).toContain("git.worktree.create.started");
    expect(events).toContain("git.worktree.create.failed");
    expect(events).not.toContain("git.worktree.create.fetched");
  });

  test("removeWorktree is non-required and delegates to the runner", async () => {
    const calls: string[][] = [];
    const runner: GitRunner = {
      run: async (args) => {
        calls.push(args);
        return { stdout: "", stderr: "" };
      },
    };
    expect(git.removeWorktree.required).toBe(false);
    await runCapability(git.removeWorktree, {
      projectRoot: root,
      cwd: join(root, "wt"),
      runner,
    });
    expect(calls[0]).toEqual(["worktree", "remove", "--force", join(root, "wt")]);
  });

  test("removeWorktree emits started + failed and rethrows on runner error", async () => {
    const bus = createBus();
    const events: string[] = [];
    bus.on("*", (e) => events.push(e.type as string));
    const runner: GitRunner = {
      run: async () => {
        throw new Error("remove failed");
      },
    };
    await expect(
      runCapability(
        git.removeWorktree,
        { projectRoot: root, cwd: join(root, "wt"), runner },
        { bus },
      ),
    ).rejects.toThrow("remove failed");
    expect(events).toContain("git.worktree.remove.started");
    expect(events).toContain("git.worktree.remove.failed");
    expect(events).not.toContain("git.worktree.remove.fetched");
  });

  test("seedWorktreeMcpConfig copies .mcp.json rewriting .ralph/ args to absolute paths", async () => {
    const worktreeDir = join(root, "worktree");
    await mkdir(worktreeDir, { recursive: true });
    const mcpJson = {
      mcpServers: { myserver: { args: [".ralph/config.json", "--other"] } },
    };
    await Bun.write(join(root, ".mcp.json"), JSON.stringify(mcpJson));

    await runCapability(git.seedWorktreeMcpConfig, {
      projectRoot: root,
      worktreeCwd: worktreeDir,
    });

    const written = await Bun.file(join(worktreeDir, ".mcp.json")).json();
    expect(written.mcpServers.myserver.args[0]).toBe(join(root, ".ralph/config.json"));
    expect(written.mcpServers.myserver.args[1]).toBe("--other");
  });

  test("seedWorktreeMcpConfig is a no-op when no .mcp.json exists", async () => {
    const worktreeDir = join(root, "worktree");
    await mkdir(worktreeDir, { recursive: true });

    await runCapability(git.seedWorktreeMcpConfig, {
      projectRoot: root,
      worktreeCwd: worktreeDir,
    });

    expect(await Bun.file(join(worktreeDir, ".mcp.json")).exists()).toBe(false);
  });
});
