import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RALPHY_TASKS_START,
  RALPHY_TASKS_END,
  renderTasksBlock,
  applyTasksBlock,
  syncTasksToLinearDescription,
} from "../agent/linear-tasks-sync";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lts-"));
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("renderTasksBlock", () => {
  test("renders single-section tasks.md with markers and footer", () => {
    const md = `# Tasks\n\n## Planning\n\n- [x] First\n- [ ] Second\n`;
    const block = renderTasksBlock(md, { changeName: "demo", iteration: 3 });
    expect(block.startsWith(RALPHY_TASKS_START)).toBe(true);
    expect(block.endsWith(RALPHY_TASKS_END)).toBe(true);
    expect(block).toContain("### Ralph progress");
    expect(block).toContain("**Planning**");
    expect(block).toContain("- [x] First");
    expect(block).toContain("- [ ] Second");
    expect(block).toContain("`demo` · iteration 3");
  });

  test("renders multi-section tasks.md with one bold sub-label per section", () => {
    const md = `## Planning\n\n- [x] Plan A\n\n## Implementation\n\n- [ ] Impl X\n- [ ] Impl Y\n`;
    const block = renderTasksBlock(md, { changeName: "x", iteration: 1 });
    expect(block).toContain("**Planning**");
    expect(block).toContain("**Implementation**");
    expect(block.indexOf("**Planning**")).toBeLessThan(block.indexOf("**Implementation**"));
    expect(block).toContain("- [x] Plan A");
    expect(block).toContain("- [ ] Impl X");
  });

  test("collapses fenced code blocks under a bullet into a <details> disclosure", () => {
    const md = `## Implementation\n\n- [ ] Run lint\n\n\`\`\`\nerror: line\n\`\`\`\n`;
    const block = renderTasksBlock(md, { changeName: "x", iteration: 1 });
    expect(block).toContain("<details><summary>output</summary><pre>error: line</pre></details>");
  });

  test("truncates code blocks longer than 2 KB", () => {
    const big = "x".repeat(3000);
    const md = `## Implementation\n\n- [ ] Big\n\n\`\`\`\n${big}\n\`\`\`\n`;
    const block = renderTasksBlock(md, { changeName: "x", iteration: 1 });
    expect(block).toContain("…(truncated)");
  });
});

describe("applyTasksBlock", () => {
  test("inserts block when none exists, preserving leading prose", () => {
    const desc = "Existing prose.";
    const block = `${RALPHY_TASKS_START}\nfoo\n${RALPHY_TASKS_END}`;
    const out = applyTasksBlock(desc, block);
    expect(out.startsWith("Existing prose.")).toBe(true);
    expect(out.endsWith(RALPHY_TASKS_END)).toBe(true);
    expect(out).toContain(`\n\n${RALPHY_TASKS_START}`);
  });

  test("replaces block when one already exists, preserving prose before/after", () => {
    const before = "Header text.\n\n";
    const after = "\n\nTrailing footer.";
    const oldBlock = `${RALPHY_TASKS_START}\nold body\n${RALPHY_TASKS_END}`;
    const newBlock = `${RALPHY_TASKS_START}\nnew body\n${RALPHY_TASKS_END}`;
    const desc = `${before}${oldBlock}${after}`;
    const out = applyTasksBlock(desc, newBlock);
    expect(out).toBe(`${before}${newBlock}${after}`);
  });

  test("idempotent: applying the same block twice yields identical output", () => {
    const block = `${RALPHY_TASKS_START}\nbody\n${RALPHY_TASKS_END}`;
    const once = applyTasksBlock("prose", block);
    const twice = applyTasksBlock(once, block);
    expect(twice).toBe(once);
  });

  test("null description with block returns block alone", () => {
    const block = `${RALPHY_TASKS_START}\nx\n${RALPHY_TASKS_END}`;
    expect(applyTasksBlock(null, block)).toBe(block);
  });
});

describe("syncTasksToLinearDescription orchestrator", () => {
  test("skipped when tasks.md is missing; no GraphQL call", async () => {
    const calls: unknown[] = [];
    const log: string[] = [];
    const out = await syncTasksToLinearDescription({
      apiKey: "k",
      issueId: "i",
      currentDescription: null,
      tasksPath: join(tempDir, "missing.md"),
      changeName: "demo",
      iteration: 1,
      log: (t) => log.push(t),
      updateIssueDescription: async (...args) => {
        calls.push(args);
      },
    });
    expect(out).toBeNull();
    expect(calls.length).toBe(0);
    expect(log.some((l) => l.includes("missing"))).toBe(true);
  });

  test("no-op when computed description equals current", async () => {
    const tasksPath = join(tempDir, "tasks.md");
    await Bun.write(tasksPath, "## Planning\n\n- [x] one\n");
    const block = renderTasksBlock("## Planning\n\n- [x] one\n", {
      changeName: "demo",
      iteration: 2,
    });
    const current = `prelude\n\n${block}`;
    const calls: unknown[] = [];
    const out = await syncTasksToLinearDescription({
      apiKey: "k",
      issueId: "i",
      currentDescription: current,
      tasksPath,
      changeName: "demo",
      iteration: 2,
      log: () => {},
      updateIssueDescription: async (...args) => {
        calls.push(args);
      },
    });
    expect(out).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("failure from updateIssueDescription is caught and logged", async () => {
    const tasksPath = join(tempDir, "tasks.md");
    await Bun.write(tasksPath, "## Planning\n\n- [ ] one\n");
    const log: { t: string; c?: string }[] = [];
    const out = await syncTasksToLinearDescription({
      apiKey: "k",
      issueId: "i",
      currentDescription: "prose",
      tasksPath,
      changeName: "demo",
      iteration: 1,
      log: (t, c) => log.push({ t, ...(c ? { c } : {}) }),
      updateIssueDescription: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toBeNull();
    expect(log.some((l) => l.t.includes("boom") && l.c === "yellow")).toBe(true);
  });

  test("writes update on first sync with mocked update function", async () => {
    const tasksPath = join(tempDir, "tasks.md");
    await Bun.write(tasksPath, "## Planning\n\n- [ ] one\n");
    const calls: { id: string; desc: string }[] = [];
    const out = await syncTasksToLinearDescription({
      apiKey: "k",
      issueId: "issue-1",
      currentDescription: "prose",
      tasksPath,
      changeName: "demo",
      iteration: 1,
      log: () => {},
      updateIssueDescription: async (_k, id, desc) => {
        calls.push({ id, desc });
      },
    });
    expect(out).not.toBeNull();
    expect(calls.length).toBe(1);
    expect(calls[0]!.id).toBe("issue-1");
    expect(calls[0]!.desc).toContain(RALPHY_TASKS_START);
    expect(calls[0]!.desc).toContain("- [ ] one");
    expect(calls[0]!.desc.startsWith("prose")).toBe(true);
  });
});
