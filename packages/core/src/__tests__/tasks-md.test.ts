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
  pickActiveTasksFile,
  bothFilesCompleted,
  isFlowTaskHeading,
  normalizeNewlyAppendedSection,
  normalizeNewlyAppendedSectionWithReport,
  FLOW_TASK_HEADING_PREFIXES,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
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

  test("writes to agent-tasks.md without touching tasks.md when caller routes there", async () => {
    const missionPath = join(tempDir, MISSION_TASKS_FILENAME);
    const agentPath = join(tempDir, AGENT_TASKS_FILENAME);
    await Bun.write(missionPath, "# Mission\n\n## Implementation\n\n- [x] real work\n");

    await prependFixTask(agentPath, "Fix failing CI checks", "type error in foo.ts");

    const mission = await Bun.file(missionPath).text();
    expect(mission).not.toContain("Fix failing CI checks");
    expect(allCompleted(mission)).toBe(true);

    const agent = await Bun.file(agentPath).text();
    expect(agent).toContain("## Fix failing CI checks");
    expect(agent).toContain("type error in foo.ts");
    expect(countUnchecked(agent)).toBe(1);
  });
});

describe("isFlowTaskHeading", () => {
  test("matches every canonical flow heading prefix", () => {
    for (const prefix of FLOW_TASK_HEADING_PREFIXES) {
      expect(isFlowTaskHeading(prefix)).toBe(true);
      expect(isFlowTaskHeading(`${prefix} (2026-05-15T12:00:00.000Z)`)).toBe(true);
    }
  });

  test("matches the `Resolve merge conflict with origin/<branch>` form", () => {
    expect(isFlowTaskHeading("Resolve merge conflict with origin/main")).toBe(true);
    expect(
      isFlowTaskHeading("Resolve merge conflict with origin/main (2026-05-15T12:00:00.000Z)"),
    ).toBe(true);
  });

  test("rejects unrelated mission headings", () => {
    expect(isFlowTaskHeading("Implementation")).toBe(false);
    expect(isFlowTaskHeading("Planning")).toBe(false);
    expect(isFlowTaskHeading("Add the parser")).toBe(false);
    expect(isFlowTaskHeading("Fix the user-facing bug")).toBe(false);
  });
});

describe("pickActiveTasksFile", () => {
  test("returns agent-tasks.md when it has unchecked items", async () => {
    await Bun.write(
      join(tempDir, MISSION_TASKS_FILENAME),
      "## Implementation\n\n- [ ] mission work\n",
    );
    await Bun.write(
      join(tempDir, AGENT_TASKS_FILENAME),
      "## Fix failing CI checks\n\n- [ ] fix the CI break\n",
    );

    const picked = await pickActiveTasksFile(tempDir);
    expect(picked).not.toBeNull();
    expect(picked!.filename).toBe(AGENT_TASKS_FILENAME);
    expect(picked!.path).toBe(join(tempDir, AGENT_TASKS_FILENAME));
    expect(picked!.content).toContain("fix the CI break");
  });

  test("falls back to tasks.md when agent-tasks.md is fully checked", async () => {
    await Bun.write(
      join(tempDir, MISSION_TASKS_FILENAME),
      "## Implementation\n\n- [ ] still pending\n",
    );
    await Bun.write(
      join(tempDir, AGENT_TASKS_FILENAME),
      "## Fix failing CI checks\n\n- [x] already done\n",
    );

    const picked = await pickActiveTasksFile(tempDir);
    expect(picked).not.toBeNull();
    expect(picked!.filename).toBe(MISSION_TASKS_FILENAME);
    expect(picked!.content).toContain("still pending");
  });

  test("falls back to tasks.md when agent-tasks.md does not exist", async () => {
    await Bun.write(
      join(tempDir, MISSION_TASKS_FILENAME),
      "## Implementation\n\n- [ ] mission work\n",
    );

    const picked = await pickActiveTasksFile(tempDir);
    expect(picked).not.toBeNull();
    expect(picked!.filename).toBe(MISSION_TASKS_FILENAME);
  });

  test("returns null when neither file exists", async () => {
    const picked = await pickActiveTasksFile(tempDir);
    expect(picked).toBeNull();
  });
});

describe("normalizeNewlyAppendedSection", () => {
  test("rewrites all `[x]` items in a freshly appended section to `[ ]`", () => {
    const previous = `# Tasks
## Planning

- [x] plan done
`;
    const current = `# Tasks
## Planning

- [x] plan done

## Implementation

- [x] step one
- [x] step two
`;
    const out = normalizeNewlyAppendedSection(previous, current);
    expect(out).toContain("## Implementation");
    expect(out).toContain("- [ ] step one");
    expect(out).toContain("- [ ] step two");
    // pre-existing planning section's `[x]` is preserved
    expect(out).toContain("- [x] plan done");
  });

  test("rewrites mixed-state items in an appended section to all `[ ]`", () => {
    const previous = `## Planning\n\n- [x] done\n`;
    const current = `## Planning\n\n- [x] done\n\n## Implementation\n\n- [x] a\n- [ ] b\n- [X] c\n`;
    const out = normalizeNewlyAppendedSection(previous, current);
    expect(out).toContain("- [ ] a");
    expect(out).toContain("- [ ] b");
    expect(out).toContain("- [ ] c");
    expect(out).not.toMatch(/- \[[xX]\] [abc]/);
  });

  test("leaves a pre-existing section unchanged byte-for-byte when an item is freshly checked", () => {
    const previous = `## Implementation\n\n- [ ] a\n- [ ] b\n`;
    const current = `## Implementation\n\n- [x] a\n- [ ] b\n`;
    const out = normalizeNewlyAppendedSection(previous, current);
    expect(out).toBe(current);
  });

  test("returns input unchanged byte-for-byte when appended section has only `[ ]` items", () => {
    const previous = `## Planning\n\n- [x] done\n`;
    const current = `## Planning\n\n- [x] done\n\n## Implementation\n\n- [ ] a\n- [ ] b\n`;
    const out = normalizeNewlyAppendedSection(previous, current);
    expect(out).toBe(current);
  });

  test("rewrites indented sub-items in a newly appended section", () => {
    const previous = `## Planning\n`;
    const current = `## Planning\n\n## Implementation\n\n- [x] parent\n  - [x] child\n    - [X] grandchild\n`;
    const out = normalizeNewlyAppendedSection(previous, current);
    expect(out).toContain("- [ ] parent");
    expect(out).toContain("  - [ ] child");
    expect(out).toContain("    - [ ] grandchild");
  });

  test("does not rewrite `[x]` text occurring mid-line inside an item description", () => {
    const previous = `## Planning\n`;
    const current = `## Planning\n\n## Implementation\n\n- [ ] verify that "[x]" renders as checked\n- [x] actually done\n`;
    const out = normalizeNewlyAppendedSection(previous, current);
    expect(out).toContain(`- [ ] verify that "[x]" renders as checked`);
    expect(out).toContain("- [ ] actually done");
  });

  test("report variant identifies affected heading and count", () => {
    const previous = `## Planning\n\n- [x] done\n`;
    const current = `## Planning\n\n- [x] done\n\n## Implementation\n\n- [x] one\n- [x] two\n- [ ] three\n`;
    const r = normalizeNewlyAppendedSectionWithReport(previous, current);
    expect(r.count).toBe(2);
    expect(r.headings).toEqual(["Implementation"]);
    expect(r.text).toContain("- [ ] one");
    expect(r.text).toContain("- [ ] two");
  });

  test("report variant returns zero changes when nothing needed fixing", () => {
    const previous = `## Planning\n`;
    const current = `## Planning\n\n## Implementation\n\n- [ ] a\n`;
    const r = normalizeNewlyAppendedSectionWithReport(previous, current);
    expect(r.count).toBe(0);
    expect(r.headings).toEqual([]);
    expect(r.text).toBe(current);
  });
});

describe("bothFilesCompleted", () => {
  test("true when only tasks.md exists and is clean", async () => {
    await Bun.write(join(tempDir, MISSION_TASKS_FILENAME), "## Done\n\n- [x] done\n");
    expect(await bothFilesCompleted(tempDir)).toBe(true);
  });

  test("false when agent-tasks.md still has unchecked items", async () => {
    await Bun.write(join(tempDir, MISSION_TASKS_FILENAME), "## Done\n\n- [x] done\n");
    await Bun.write(
      join(tempDir, AGENT_TASKS_FILENAME),
      "## Fix failing CI checks\n\n- [ ] not yet\n",
    );
    expect(await bothFilesCompleted(tempDir)).toBe(false);
  });

  test("false when tasks.md still has unchecked items even if agent-tasks.md is clean", async () => {
    await Bun.write(join(tempDir, MISSION_TASKS_FILENAME), "## Mission\n\n- [ ] mission work\n");
    await Bun.write(
      join(tempDir, AGENT_TASKS_FILENAME),
      "## Fix failing CI checks\n\n- [x] done\n",
    );
    expect(await bothFilesCompleted(tempDir)).toBe(false);
  });

  test("true when neither file exists", async () => {
    expect(await bothFilesCompleted(tempDir)).toBe(true);
  });
});
