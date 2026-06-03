import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../index";

/**
 * `ralphy init --project-root … --workflow …` must read and write the alternate
 * file, not the canonical `<project>/WORKFLOW.md`. These run in the test's
 * non-interactive shell, so `main` takes the `ensureWorkflow` default-write
 * branch — enough to prove the path overrides are honored end to end.
 */
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "init-path-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ralphy init path overrides", () => {
  test("--workflow writes the file at the given path, not the canonical one", async () => {
    const customPath = join(tempDir, "nested", "my-workflow.md");
    const code = await main(["--project-root", tempDir, "--workflow", customPath]);
    expect(code).toBe(0);
    expect(await Bun.file(customPath).exists()).toBe(true);
    expect(await Bun.file(customPath).text()).toContain("project:");
    // The canonical location is left untouched.
    expect(await Bun.file(join(tempDir, "WORKFLOW.md")).exists()).toBe(false);
  });

  test("without --workflow, falls back to <project>/WORKFLOW.md", async () => {
    const code = await main(["--project-root", tempDir]);
    expect(code).toBe(0);
    expect(await Bun.file(join(tempDir, "WORKFLOW.md")).exists()).toBe(true);
  });

  test("an existing file at the override path is left unchanged in a non-interactive shell", async () => {
    const customPath = join(tempDir, "my-workflow.md");
    await Bun.write(customPath, "sentinel — do not overwrite\n");
    const code = await main(["--project-root", tempDir, "--workflow", customPath]);
    expect(code).toBe(0);
    expect(await Bun.file(customPath).text()).toBe("sentinel — do not overwrite\n");
  });
});
