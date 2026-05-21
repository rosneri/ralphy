import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTmpRepo } from "../tmp-repo";

async function readFile(path: string): Promise<string> {
  return await Bun.file(path).text();
}

describe("createTmpRepo", () => {
  test("seeds commits and detects a conflicting merge", async () => {
    const repo = await createTmpRepo();
    const sha = await repo.seedCommit("foo.txt", "hello\n", "add foo");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(repo.dir, "foo.txt"))).toBe(true);
    const txt = await readFile(join(repo.dir, "foo.txt"));
    expect(txt).toBe("hello\n");

    await repo.makeConflict("feature", "foo.txt", "feature-side\n");

    // Attempt to merge feature into main and expect conflict markers / non-zero exit.
    const proc = Bun.spawn({
      cmd: ["git", "merge", "--no-commit", "--no-ff", "feature"],
      cwd: repo.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).not.toBe(0);

    await repo.cleanup();
    expect(existsSync(repo.dir)).toBe(false);
  });
});
