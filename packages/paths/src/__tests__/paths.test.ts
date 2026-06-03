import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { worktreesDir, findProjectRoot } from "../paths";

describe("worktreesDir", () => {
  test("returns a homedir-anchored path", () => {
    const dir = worktreesDir("/tmp/foo");
    expect(dir).toContain(".ralph");
    expect(dir).toContain("worktrees");
    expect(dir).toContain("foo");
  });
});

describe("findProjectRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paths-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("roots at the directory that has WORKFLOW.md", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), "---\n---\n");
    expect(await findProjectRoot(tempDir)).toBe(tempDir);
  });

  test("walks up to the nearest ancestor carrying WORKFLOW.md", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), "---\n---\n");
    const nested = join(tempDir, "packages", "inner");
    mkdirSync(nested, { recursive: true });
    expect(await findProjectRoot(nested)).toBe(tempDir);
  });

  test("openspec/ is NOT a marker — a dir with only openspec/ falls back to startDir", async () => {
    mkdirSync(join(tempDir, "openspec"));
    const nested = join(tempDir, "sub");
    mkdirSync(nested);
    // No WORKFLOW.md anywhere up the tree → falls back to startDir, not tempDir.
    expect(await findProjectRoot(nested)).toBe(nested);
  });

  test("falls back to startDir when no WORKFLOW.md is found", async () => {
    const bare = join(tempDir, "bare");
    mkdirSync(bare);
    expect(await findProjectRoot(bare)).toBe(bare);
  });
});
