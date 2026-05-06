import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  firstUnchecked,
  countUnchecked,
  allCompleted,
  prependSection,
  prependFixTask,
} from "../tasks-md";

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tasks-md-test-"));
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("prependSection + firstUnchecked round-trip", () => {
  test("a freshly prepended section is the one firstUnchecked picks", () => {
    const original = `# Tasks for foo

## Already worked on this
- [x] done thing
- [x] another done thing
`;
    const next = prependSection(original, "Fix CI", "- [ ] Fix the failing test\n");
    const picked = firstUnchecked(next);
    expect(picked).not.toBeNull();
    expect(picked!).toContain("## Fix CI");
    expect(picked!).toContain("- [ ] Fix the failing test");
  });

  test("preserves leading content (title block) when inserting before first ##", () => {
    const original = `# Tasks for foo

intro paragraph

## Existing
- [ ] existing item
`;
    const next = prependSection(original, "New", "- [ ] new\n");
    expect(next.startsWith("# Tasks for foo")).toBe(true);
    expect(next.indexOf("## New")).toBeLessThan(next.indexOf("## Existing"));
  });

  test("appends section when file has no existing ## headings", () => {
    const next = prependSection("# Just a title\n", "First", "- [ ] item\n");
    expect(next).toContain("# Just a title");
    expect(next).toContain("## First");
    expect(next.indexOf("# Just a title")).toBeLessThan(next.indexOf("## First"));
  });

  test("works on empty input", () => {
    const next = prependSection("", "First", "- [ ] item\n");
    expect(next).toBe("## First\n\n- [ ] item\n\n");
  });
});

describe("prependFixTask round-trip on disk", () => {
  test("written section is selected by firstUnchecked", async () => {
    const path = join(tempDir, "tasks.md");
    await Bun.write(
      path,
      `# Tasks

## Stale section
- [x] this is done
`,
    );
    await prependFixTask(path, "Fix the broken push", "fatal: hook declined");
    const content = await Bun.file(path).text();
    const picked = firstUnchecked(content);
    expect(picked).not.toBeNull();
    expect(picked!).toContain("Fix the broken push");
    expect(picked!).toContain("fatal: hook declined");
    expect(countUnchecked(content)).toBe(1);
    expect(allCompleted(content)).toBe(false);
  });

  test("multiple prepends stack newest-first", async () => {
    const path = join(tempDir, "tasks.md");
    await Bun.write(path, "# Tasks\n");
    await prependFixTask(path, "First fix", "err A");
    await prependFixTask(path, "Second fix", "err B");
    const content = await Bun.file(path).text();
    expect(content.indexOf("Second fix")).toBeLessThan(content.indexOf("First fix"));
    const picked = firstUnchecked(content);
    expect(picked!).toContain("Second fix");
  });
});
