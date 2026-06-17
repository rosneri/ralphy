import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPrePushHook } from "../worktree";
import type { GitRunner } from "../worktree";

// End-to-end exercise of the installed pre-push hook script: drive its stdin
// like git would (`<local ref> <local sha> <remote ref> <remote sha>`) and
// assert exit code + stderr against the policy.

interface RunResult {
  exitCode: number;
  stderr: string;
}

async function runHook(
  hookPath: string,
  cwd: string,
  stdin: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn([hookPath], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  proc.stdin.write(stdin);
  await proc.stdin.end();
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { exitCode, stderr };
}

const ZERO = "0".repeat(40);

let repo = "";
let hookPath = "";

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "ralph-hook-"));
  // Install the hook into a synthetic worktree dir. We don't need a real git
  // worktree for the script's branch+force checks except the force-push branch
  // requires `git merge-base --is-ancestor` to resolve — we init a git repo
  // and craft commits below for those scenarios.
  const noopRunner: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };
  await installPrePushHook(repo, noopRunner);
  hookPath = join(repo, ".ralph-hooks", "pre-push");
  // Init a real git repo so merge-base works for the force-push scenarios.
  await Bun.spawn(["git", "init", "-q"], { cwd: repo }).exited;
  await Bun.spawn(["git", "config", "user.email", "t@t"], { cwd: repo }).exited;
  await Bun.spawn(["git", "config", "user.name", "t"], { cwd: repo }).exited;
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("pre-push hook policy", () => {
  test("allows push to refs/heads/ralph/* (new branch, remote sha is zero)", async () => {
    const stdin = `refs/heads/ralph/foo deadbeef refs/heads/ralph/foo ${ZERO}\n`;
    const res = await runHook(hookPath, repo, stdin);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");
  });

  test("rejects push to refs/heads/main", async () => {
    const stdin = `refs/heads/ralph/foo deadbeef refs/heads/main ${ZERO}\n`;
    const res = await runHook(hookPath, repo, stdin);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/refusing push to refs\/heads\/main/);
  });

  test("rejects push to a non-ralph branch", async () => {
    const stdin = `refs/heads/anything sha refs/heads/some-other-branch ${ZERO}\n`;
    const res = await runHook(hookPath, repo, stdin);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/only refs\/heads\/ralph\/\* allowed/);
  });

  test("rejects force-push when local does not contain remote sha and override is unset", async () => {
    // Build two divergent commits A,B both children of an initial root.
    const sh = async (args: string[]) => {
      const p = Bun.spawn(["git", ...args], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(p.stdout).text();
      await p.exited;
      return out.trim();
    };
    await Bun.write(join(repo, "f"), "0");
    await Bun.spawn(["git", "add", "f"], { cwd: repo }).exited;
    await Bun.spawn(["git", "commit", "-qm", "root"], { cwd: repo }).exited;
    const root = await sh(["rev-parse", "HEAD"]);
    await Bun.write(join(repo, "f"), "A");
    await Bun.spawn(["git", "commit", "-qam", "A"], { cwd: repo }).exited;
    const a = await sh(["rev-parse", "HEAD"]);
    await Bun.spawn(["git", "reset", "-q", "--hard", root], { cwd: repo }).exited;
    await Bun.write(join(repo, "f"), "B");
    await Bun.spawn(["git", "commit", "-qam", "B"], { cwd: repo }).exited;
    const b = await sh(["rev-parse", "HEAD"]);
    // remote = A, local = B → A is NOT an ancestor of B → force update.
    const stdin = `refs/heads/ralph/foo ${b} refs/heads/ralph/foo ${a}\n`;
    const res = await runHook(hookPath, repo, stdin);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/refusing force-push/);
  });

  test("allows force-push when RALPH_ALLOW_FORCE_PUSH=1 is set", async () => {
    // Same setup as above.
    const sh = async (args: string[]) => {
      const p = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe" });
      const out = await new Response(p.stdout).text();
      await p.exited;
      return out.trim();
    };
    await Bun.write(join(repo, "f"), "0");
    await Bun.spawn(["git", "add", "f"], { cwd: repo }).exited;
    await Bun.spawn(["git", "commit", "-qm", "root"], { cwd: repo }).exited;
    const root = await sh(["rev-parse", "HEAD"]);
    await Bun.write(join(repo, "f"), "A");
    await Bun.spawn(["git", "commit", "-qam", "A"], { cwd: repo }).exited;
    const a = await sh(["rev-parse", "HEAD"]);
    await Bun.spawn(["git", "reset", "-q", "--hard", root], { cwd: repo }).exited;
    await Bun.write(join(repo, "f"), "B");
    await Bun.spawn(["git", "commit", "-qam", "B"], { cwd: repo }).exited;
    const b = await sh(["rev-parse", "HEAD"]);
    const stdin = `refs/heads/ralph/foo ${b} refs/heads/ralph/foo ${a}\n`;
    const res = await runHook(hookPath, repo, stdin, { RALPH_ALLOW_FORCE_PUSH: "1" });
    expect(res.exitCode).toBe(0);
  });

  // A new-branch push (remote sha zero) clears the ref + force guards, so these
  // exercise the quality-gate stage that follows. `bun run <script>` resolves
  // against the worktree-root package.json, so a fake one stands in for the real
  // (heavy) checks.
  const newBranchPush = `refs/heads/ralph/foo deadbeef refs/heads/ralph/foo ${ZERO}\n`;

  async function writePackageJson(scripts: Record<string, string>): Promise<void> {
    await Bun.write(join(repo, "package.json"), JSON.stringify({ name: "fake", scripts }));
  }

  test("runs check:structure + fmt:check gates and allows push when both pass", async () => {
    await writePackageJson({ "check:structure": "exit 0", "fmt:check": "exit 0" });
    const res = await runHook(hookPath, repo, newBranchPush);
    expect(res.exitCode).toBe(0);
  });

  test("rejects push when check:structure gate fails", async () => {
    await writePackageJson({ "check:structure": "exit 1", "fmt:check": "exit 0" });
    const res = await runHook(hookPath, repo, newBranchPush);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/check:structure/);
  });

  test("rejects push when fmt:check gate fails", async () => {
    await writePackageJson({ "check:structure": "exit 0", "fmt:check": "exit 1" });
    const res = await runHook(hookPath, repo, newBranchPush);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/fmt:check/);
  });

  test("skips gates when RALPH_SKIP_PREPUSH_GATES=1", async () => {
    await writePackageJson({ "check:structure": "exit 1", "fmt:check": "exit 1" });
    const res = await runHook(hookPath, repo, newBranchPush, { RALPH_SKIP_PREPUSH_GATES: "1" });
    expect(res.exitCode).toBe(0);
  });

  test("skips gates when no package.json is present", async () => {
    // No package.json written → gates are skipped, push allowed.
    const res = await runHook(hookPath, repo, newBranchPush);
    expect(res.exitCode).toBe(0);
  });

  test("allows fast-forward push (remote sha is ancestor of local)", async () => {
    const sh = async (args: string[]) => {
      const p = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe" });
      const out = await new Response(p.stdout).text();
      await p.exited;
      return out.trim();
    };
    await Bun.write(join(repo, "f"), "0");
    await Bun.spawn(["git", "add", "f"], { cwd: repo }).exited;
    await Bun.spawn(["git", "commit", "-qm", "c1"], { cwd: repo }).exited;
    const c1 = await sh(["rev-parse", "HEAD"]);
    await Bun.write(join(repo, "f"), "1");
    await Bun.spawn(["git", "commit", "-qam", "c2"], { cwd: repo }).exited;
    const c2 = await sh(["rev-parse", "HEAD"]);
    const stdin = `refs/heads/ralph/foo ${c2} refs/heads/ralph/foo ${c1}\n`;
    const res = await runHook(hookPath, repo, stdin);
    expect(res.exitCode).toBe(0);
  });
});
