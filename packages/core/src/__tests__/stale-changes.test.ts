import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { findStaleChanges } from "../stale-changes";

let cwd: string;

async function writeChange(name: string, tasks: string | null): Promise<void> {
  const dir = join(cwd, "openspec", "changes", name);
  await mkdir(dir, { recursive: true });
  if (tasks !== null) {
    await writeFile(join(dir, "tasks.md"), tasks);
  }
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "stale-changes-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("findStaleChanges", () => {
  test("a fully-checked change is stale; an open one is not", async () => {
    await writeChange("done-change", "- [x] one\n- [x] two\n");
    await writeChange("wip-change", "- [x] one\n- [ ] two\n");

    const stale = await findStaleChanges({ cwd });

    expect(stale).toContain("done-change");
    expect(stale).not.toContain("wip-change");
  });

  test("a change with no tasks.md is not stale", async () => {
    await writeChange("half-created", null);

    const stale = await findStaleChanges({ cwd });

    expect(stale).not.toContain("half-created");
  });

  test("a change with an empty tasks.md is not stale", async () => {
    await writeChange("empty", "");

    const stale = await findStaleChanges({ cwd });

    expect(stale).not.toContain("empty");
  });

  test("the archive directory is excluded", async () => {
    // archive/ has no tasks.md of its own, but even if it did it must
    // never be reported.
    await mkdir(join(cwd, "openspec", "changes", "archive"), { recursive: true });
    await writeFile(join(cwd, "openspec", "changes", "archive", "tasks.md"), "- [x] x\n");

    const stale = await findStaleChanges({ cwd });

    expect(stale).not.toContain("archive");
  });

  test("a missing changes directory yields an empty list", async () => {
    const stale = await findStaleChanges({ cwd });
    expect(stale).toEqual([]);
  });
});
