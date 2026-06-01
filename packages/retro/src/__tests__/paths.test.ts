import { afterAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRetroOutputPath, retroDir } from "../paths";

const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

function freshDir(name: string): string {
  const dir = join(tmpdir(), `retro-paths-${name}-${process.pid}`);
  created.push(dir);
  return dir;
}

describe("retroDir", () => {
  it("points at ~/.ralph/retro", () => {
    expect(retroDir().endsWith(join(".ralph", "retro"))).toBe(true);
  });
});

describe("resolveRetroOutputPath", () => {
  it("returns the base path when nothing exists yet", async () => {
    const dir = freshDir("free");
    const p = await resolveRetroOutputPath("RLF-212", "2026-06-01", dir);
    expect(p).toBe(join(dir, "RLF-212-2026-06-01.md"));
  });

  it("versions with -2, -3, … when earlier reports exist", async () => {
    const dir = freshDir("clash");
    const first = await resolveRetroOutputPath("RLF-212", "2026-06-01", dir);
    await Bun.write(first, "report 1");

    const second = await resolveRetroOutputPath("RLF-212", "2026-06-01", dir);
    expect(second).toBe(join(dir, "RLF-212-2026-06-01-2.md"));
    await Bun.write(second, "report 2");

    const third = await resolveRetroOutputPath("RLF-212", "2026-06-01", dir);
    expect(third).toBe(join(dir, "RLF-212-2026-06-01-3.md"));
  });

  it("creates the target directory if missing", async () => {
    const dir = join(freshDir("mkdir"), "nested", "deeper");
    const p = await resolveRetroOutputPath("RLF-9", "2026-06-01", dir);
    await Bun.write(p, "ok");
    expect(await Bun.file(p).exists()).toBe(true);
  });
});
