import { describe, expect, test } from "bun:test";
import { RALPHY_TASKS_START, RALPHY_TASKS_END, renderTasksBlock } from "../agent/linear-sync";

describe("renderTasksBlock", () => {
  test("renders single-section tasks.md with markers and footer", () => {
    const md = `# Tasks\n\n## Implementation\n\n- [x] First\n- [ ] Second\n`;
    const block = renderTasksBlock(md, { changeName: "demo", iteration: 3 });
    expect(block.startsWith(RALPHY_TASKS_START)).toBe(true);
    expect(block.endsWith(RALPHY_TASKS_END)).toBe(true);
    expect(block).toContain("### Ralph progress");
    expect(block).toContain("**Implementation**");
    expect(block).toContain("- [x] First");
    expect(block).toContain("- [ ] Second");
    expect(block).toContain("`demo` · iteration 3");
  });

  test("filters out the Planning section when rendering multi-section tasks.md", () => {
    const md = `## Planning\n\n- [x] Plan A\n\n## Implementation\n\n- [ ] Impl X\n- [ ] Impl Y\n`;
    const block = renderTasksBlock(md, { changeName: "x", iteration: 1 });
    expect(block).not.toContain("**Planning**");
    expect(block).not.toContain("- [x] Plan A");
    expect(block).toContain("**Implementation**");
    expect(block).toContain("- [ ] Impl X");
    expect(block).toContain("- [ ] Impl Y");
  });

  test("renders a placeholder when only a Planning section is present", () => {
    const md = `## Planning\n\n- [ ] Draft proposal\n- [ ] Outline design\n`;
    const block = renderTasksBlock(md, { changeName: "demo", iteration: 2 });
    expect(block.startsWith(RALPHY_TASKS_START)).toBe(true);
    expect(block.endsWith(RALPHY_TASKS_END)).toBe(true);
    expect(block).toContain("_No mission tasks yet — planning in progress._");
    expect(block).toContain("`demo` · iteration 2");
    expect(block).not.toContain("**Planning**");
    expect(block).not.toContain("- [ ] Draft proposal");
    expect(block).not.toContain("- [ ] Outline design");
  });

  test("filters Planning heading case-insensitively", () => {
    const lower = `## planning\n\n- [ ] lower\n\n## Implementation\n\n- [ ] Impl\n`;
    const lowerBlock = renderTasksBlock(lower, { changeName: "x", iteration: 1 });
    expect(lowerBlock).not.toContain("- [ ] lower");
    expect(lowerBlock).not.toContain("**planning**");
    expect(lowerBlock).toContain("**Implementation**");

    const upper = `## PLANNING\n\n- [ ] upper\n\n## Implementation\n\n- [ ] Impl\n`;
    const upperBlock = renderTasksBlock(upper, { changeName: "x", iteration: 1 });
    expect(upperBlock).not.toContain("- [ ] upper");
    expect(upperBlock).not.toContain("**PLANNING**");
    expect(upperBlock).toContain("**Implementation**");
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
