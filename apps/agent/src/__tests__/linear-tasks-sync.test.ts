import { describe, expect, test } from "bun:test";
import { RALPHY_TASKS_START, RALPHY_TASKS_END, renderTasksBlock } from "../agent/linear-sync";

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
