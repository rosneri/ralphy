import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { findStaleChanges } from "../../packages/core/src/stale-changes";

// The guard script itself is a thin threshold wrapper; the classification
// logic it relies on lives in findStaleChanges. Cover that contract over a
// temp fixture so the guard's verdict is well-defined.

let cwd: string;

async function writeChange(name: string, tasks: string): Promise<void> {
  const dir = join(cwd, "openspec", "changes", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tasks.md"), tasks);
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "check-stale-changes-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("check-stale-changes classification", () => {
  test("completed changes are counted, incomplete ones are not", async () => {
    await writeChange("a-done", "- [x] x\n");
    await writeChange("b-done", "- [x] x\n- [x] y\n");
    await writeChange("c-open", "- [ ] x\n");

    const stale = await findStaleChanges({ cwd });

    expect(stale.sort()).toEqual(["a-done", "b-done"]);
  });
});
