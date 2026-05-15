import { describe, expect, test } from "bun:test";
import { runBaseline } from "../agent/baseline/runner";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";

function makeGit(opts?: { failOn?: string }): GitRunner {
  return {
    run: async (args) => {
      const joined = args.join(" ");
      if (opts?.failOn && joined.includes(opts.failOn)) {
        const err = new Error("git failed") as Error & { stderr?: string };
        err.stderr = "fatal: bad ref";
        throw err;
      }
      return { stdout: "", stderr: "" };
    },
  };
}

function makeCmd(map: Record<string, { code?: number; stdout?: string; stderr?: string }>): {
  runner: CmdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      const key = cmd.join(" ");
      const entry = map[key];
      if (!entry || (entry.code ?? 0) === 0) {
        return { stdout: entry?.stdout ?? "", stderr: entry?.stderr ?? "" };
      }
      const err = new Error("command failed") as Error & {
        code?: number;
        stderr?: string;
        stdout?: string;
      };
      err.code = entry.code ?? 1;
      err.stderr = entry.stderr ?? "";
      err.stdout = entry.stdout ?? "";
      throw err;
    },
  };
  return { runner, calls };
}

describe("runBaseline", () => {
  test("ok=true when all commands succeed", async () => {
    const { runner } = makeCmd({
      "bun run lint": { code: 0 },
      "bun test": { code: 0 },
    });
    const r = await runBaseline({
      cmdRunner: runner,
      gitRunner: makeGit(),
      cwd: "/tmp/baseline",
      commands: ["bun run lint", "bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
    });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.fingerprint).toBe("");
  });

  test("captures a single failing command with fingerprint", async () => {
    const { runner } = makeCmd({
      "bun run lint": { code: 0 },
      "bun test": { code: 2, stderr: "AssertionError: x !== y\n  at foo" },
    });
    const r = await runBaseline({
      cmdRunner: runner,
      gitRunner: makeGit(),
      cwd: "/tmp/baseline",
      commands: ["bun run lint", "bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.command).toBe("bun test");
    expect(r.failures[0]!.exitCode).toBe(2);
    expect(r.fingerprint).toBe(r.failures[0]!.fingerprint);
    expect(r.fingerprint.length).toBe(12);
  });

  test("fingerprint stable across whitespace-only stderr changes", async () => {
    const make = (stderr: string) => makeCmd({ "bun test": { code: 1, stderr } }).runner;

    const r1 = await runBaseline({
      cmdRunner: make("Error: x  \n  details"),
      gitRunner: makeGit(),
      cwd: "/tmp",
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
    });
    const r2 = await runBaseline({
      cmdRunner: make("Error: x\n  details"),
      gitRunner: makeGit(),
      cwd: "/tmp",
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
    });
    expect(r1.fingerprint).toBe(r2.fingerprint);
  });

  test("truncates stderr beyond outputCharLimit", async () => {
    const huge = "x".repeat(10_000);
    const { runner } = makeCmd({ "bun test": { code: 1, stderr: huge } });
    const r = await runBaseline({
      cmdRunner: runner,
      gitRunner: makeGit(),
      cwd: "/tmp",
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 100,
    });
    expect(r.failures[0]!.stderr.length).toBeLessThan(500);
    expect(r.failures[0]!.stderr).toContain("truncated");
  });

  test("git checkout failure handled as a synthetic failure", async () => {
    const { runner } = makeCmd({});
    const r = await runBaseline({
      cmdRunner: runner,
      gitRunner: makeGit({ failOn: "reset" }),
      cwd: "/tmp",
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.command).toContain("git checkout");
  });
});
