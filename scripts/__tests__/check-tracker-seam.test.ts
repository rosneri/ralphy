import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  collectGuardedFiles,
  findViolations,
  isExcludedTestPath,
  linearImportBindings,
} from "../check-tracker-seam";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("linearImportBindings (the matcher)", () => {
  test("FAILS on a Linear* named type import — the leak we guard against", () => {
    const src = `import type { LinearIssue } from "@ralphy/tracker";`;
    expect(linearImportBindings(src)).toEqual(["LinearIssue"]);
  });

  test("PASSES on a Tracked* import — the neutral shape", () => {
    const src = `import type { TrackedIssue } from "@ralphy/tracker";`;
    expect(linearImportBindings(src)).toEqual([]);
  });

  test("flags multiple and aliased Linear* bindings (both sides of `as`)", () => {
    const src = [
      `import { LinearComment, TrackedIssue } from "@ralphy/tracker";`,
      `import type { LinearIssue as LI } from "../agent/linear";`,
    ].join("\n");
    expect(linearImportBindings(src)).toEqual(["LinearComment", "LinearIssue"]);
  });

  test("flags Linear* inside a multi-line import list", () => {
    const src = `import type {\n  TrackedIssue,\n  LinearIssue,\n} from "@ralphy/tracker";`;
    expect(linearImportBindings(src)).toEqual(["LinearIssue"]);
  });

  test("inspects binding names, not module paths — a non-Linear* binding from a Linear-named module is allowed", () => {
    const src = `import { issueMatchesGetIndicator } from "../agent/linear";`;
    expect(linearImportBindings(src)).toEqual([]);
  });
});

describe("isExcludedTestPath", () => {
  test("excludes *.test.ts and __tests__/ paths", () => {
    expect(isExcludedTestPath("apps/agent/src/runtime/__tests__/runtime-signals.test.ts")).toBe(
      true,
    );
    expect(isExcludedTestPath("apps/agent/src/runtime/foo.test.ts")).toBe(true);
  });

  test("includes production source", () => {
    expect(isExcludedTestPath("apps/agent/src/runtime/coordinator.ts")).toBe(false);
    expect(isExcludedTestPath("packages/core/src/machines/flow.machine.ts")).toBe(false);
  });
});

describe("guard over the real tree", () => {
  test("a Linear* import living at an excluded test path is skipped, not flagged", async () => {
    const testFile = "apps/agent/src/runtime/__tests__/runtime-signals.test.ts";
    const content = await Bun.file(join(REPO_ROOT, testFile)).text();
    // Sanity: this real file really does import a Linear* binding…
    expect(linearImportBindings(content).length).toBeGreaterThan(0);
    // …yet it is excluded from the guarded set, so it is never flagged.
    expect(isExcludedTestPath(testFile)).toBe(true);
    const files = await collectGuardedFiles(REPO_ROOT);
    expect(files).not.toContain(testFile);
  });

  test("collects production core files (e.g. the migrated coordinator)", async () => {
    const files = await collectGuardedFiles(REPO_ROOT);
    expect(files).toContain("apps/agent/src/runtime/coordinator.ts");
    expect(files).toContain("apps/agent/src/queue/queue-order.ts");
    expect(files.some((f) => f.includes("__tests__"))).toBe(false);
  });

  test("the migrated tree has zero violations (guard exits clean)", async () => {
    expect(await findViolations(REPO_ROOT)).toEqual([]);
  });
});
