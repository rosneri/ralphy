import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface TmpRepo {
  dir: string;
  seedCommit: (path: string, contents: string, message: string) => Promise<string>;
  forcePushBase: (branch: string, sha: string) => Promise<void>;
  makeConflict: (branch: string, path: string, contents: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ralphy Test",
      GIT_AUTHOR_EMAIL: "test@ralphy.local",
      GIT_COMMITTER_NAME: "Ralphy Test",
      GIT_COMMITTER_EMAIL: "test@ralphy.local",
    },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error("git command failed", { cause: { args, code, stderr } });
  }
  return stdout.trim();
}

export async function createTmpRepo(): Promise<TmpRepo> {
  const dir = await mkdtemp(join(tmpdir(), "ralphy-harness-repo-"));
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "commit.gpgsign", "false"], dir);
  // Seed an initial commit so HEAD exists.
  await Bun.write(join(dir, "README.md"), "# tmp repo\n");
  await git(["add", "README.md"], dir);
  await git(["commit", "-q", "-m", "init"], dir);

  async function seedCommit(path: string, contents: string, message: string): Promise<string> {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await Bun.write(full, contents);
    await git(["add", path], dir);
    await git(["commit", "-q", "-m", message], dir);
    return await git(["rev-parse", "HEAD"], dir);
  }

  async function forcePushBase(branch: string, sha: string): Promise<void> {
    await git(["branch", "-f", branch, sha], dir);
  }

  async function makeConflict(branch: string, path: string, contents: string): Promise<void> {
    // Create a branch with a divergent change to `path`.
    const mainSha = await git(["rev-parse", "HEAD"], dir);
    await git(["checkout", "-q", "-b", branch], dir);
    await Bun.write(join(dir, path), contents);
    await git(["add", path], dir);
    await git(["commit", "-q", "-m", `conflict on ${branch}`], dir);
    await git(["checkout", "-q", "main"], dir);
    // Touch the same file on main with a different content so a merge would conflict.
    await Bun.write(join(dir, path), contents + "\n// upstream diverged\n");
    await git(["add", path], dir);
    await git(["commit", "-q", "-m", `upstream change after ${mainSha.slice(0, 7)}`], dir);
  }

  async function cleanup(): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }

  return { dir, seedCommit, forcePushBase, makeConflict, cleanup };
}
