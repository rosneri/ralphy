import { describe, it, expect } from "bun:test";
import { orderSubtasksForCappedDisplay, parseSubtasks } from "../components/AgentMode";

describe("parseSubtasks", () => {
  it("skips items under a Planning heading and returns the rest in order", () => {
    const md = [
      "# Tasks",
      "",
      "## Planning",
      "- [x] done thing",
      "- [ ] first pending",
      "- [ ] second pending",
      "",
      "## Implementation",
      "- [x] another done",
      "- [ ] third pending",
    ].join("\n");
    expect(parseSubtasks(md)).toEqual([
      { done: true, text: "another done" },
      { done: false, text: "third pending" },
    ]);
  });

  it("keeps items when there is no Planning section", () => {
    const md = ["# Tasks", "", "- [x] alpha", "- [ ] beta"].join("\n");
    expect(parseSubtasks(md)).toEqual([
      { done: true, text: "alpha" },
      { done: false, text: "beta" },
    ]);
  });

  it("treats the Planning heading case-insensitively", () => {
    const md = ["## planning", "- [ ] hidden", "## Implementation", "- [ ] kept"].join("\n");
    expect(parseSubtasks(md)).toEqual([{ done: false, text: "kept" }]);
  });

  it("resumes parsing after Planning when a new section begins", () => {
    const md = [
      "## Planning",
      "- [ ] hidden one",
      "- [ ] hidden two",
      "## Other",
      "- [x] shown one",
      "- [ ] shown two",
    ].join("\n");
    expect(parseSubtasks(md)).toEqual([
      { done: true, text: "shown one" },
      { done: false, text: "shown two" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseSubtasks("")).toEqual([]);
  });

  it("trims whitespace on items", () => {
    expect(parseSubtasks("- [ ]   spaced item   ")).toEqual([{ done: false, text: "spaced item" }]);
    expect(parseSubtasks("- [x]   done item   ")).toEqual([{ done: true, text: "done item" }]);
  });

  it("ignores non-task lines", () => {
    const md = "Some prose\n- [ ] real task\nMore prose\n* [ ] not a task\n- [x] done task\n";
    expect(parseSubtasks(md)).toEqual([
      { done: false, text: "real task" },
      { done: true, text: "done task" },
    ]);
  });

  it("skips legacy flow-task sections in tasks.md (backward compat)", () => {
    const md = [
      "# Tasks",
      "",
      "## Planning",
      "- [ ] plan hidden",
      "",
      "## Fix failing CI checks (2026-05-01T12:00:00Z)",
      "- [ ] hidden CI repair task",
      "",
      "## Implementation",
      "- [x] real done",
      "- [ ] real pending",
      "",
      "## Resolve PR merge conflicts (2026-05-02T13:00:00Z)",
      "- [ ] hidden merge conflict task",
    ].join("\n");
    expect(parseSubtasks(md)).toEqual([
      { done: true, text: "real done" },
      { done: false, text: "real pending" },
    ]);
  });

  it("skips Address reviewer comments and @ralphy mention sections", () => {
    const md = [
      "## Implementation",
      "- [ ] mission task",
      "",
      "## Address reviewer comments (2026-05-03T13:00:00Z)",
      "- [ ] hidden review task",
      "",
      "## Address GitHub @ralphy mention (2026-05-03T13:01:00Z)",
      "- [ ] hidden github mention",
      "",
      "## Address Linear @ralphy mention (2026-05-03T13:02:00Z)",
      "- [ ] hidden linear mention",
    ].join("\n");
    expect(parseSubtasks(md)).toEqual([{ done: false, text: "mission task" }]);
  });
});

describe("derived taskProgress from parseSubtasks", () => {
  it("counts only Implementation items, ignoring Planning and flow-task sections", () => {
    // Regression for RLF-70: the progress bar previously used countProgress()
    // which counted every `- [ ]` / `- [x]` in tasks.md including Planning and
    // flow-task sections. The derived value must match the parsed subtasks.
    const planning = Array.from({ length: 6 }, (_, i) => `- [x] plan ${i + 1}`).join("\n");
    const implementation = Array.from({ length: 10 }, (_, i) => `- [ ] impl ${i + 1}`).join("\n");
    const tasksMd = [
      "# Tasks",
      "",
      "## Planning",
      planning,
      "",
      "## Implementation",
      implementation,
      "",
      "## Fix failing CI checks (2026-05-01T12:00:00Z)",
      "- [ ] hidden CI repair task",
      "",
    ].join("\n");
    const subtasks = parseSubtasks(tasksMd);
    const total = subtasks.length;
    const checked = subtasks.filter((s) => s.done).length;
    expect({ checked, total }).toEqual({ checked: 0, total: 10 });
  });
});

describe("orderSubtasksForCappedDisplay", () => {
  it("puts unchecked items before completed items, stable in file order", () => {
    const subtasks = [
      { done: true, text: "old done a" },
      { done: true, text: "old done b" },
      { done: false, text: "fix failing CI checks" },
      { done: true, text: "old done c" },
      { done: false, text: "previous mission task" },
    ];
    expect(orderSubtasksForCappedDisplay(subtasks)).toEqual([
      { done: false, text: "fix failing CI checks" },
      { done: false, text: "previous mission task" },
      { done: true, text: "old done a" },
      { done: true, text: "old done b" },
      { done: true, text: "old done c" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(orderSubtasksForCappedDisplay([])).toEqual([]);
  });

  it("leaves all-unchecked input unchanged", () => {
    const subtasks = [
      { done: false, text: "a" },
      { done: false, text: "b" },
      { done: false, text: "c" },
    ];
    expect(orderSubtasksForCappedDisplay(subtasks)).toEqual(subtasks);
  });

  it("leaves all-done input unchanged", () => {
    const subtasks = [
      { done: true, text: "a" },
      { done: true, text: "b" },
    ];
    expect(orderSubtasksForCappedDisplay(subtasks)).toEqual(subtasks);
  });

  it("keeps freshly prepended unchecked tasks on top once the cap (15) kicks in", () => {
    // Parse a tasks.md with two unchecked items sitting above a long run of
    // completed items. The capped panel slices the *ordered* list to 15 —
    // that slice must include both pending tasks, never get crowded out by
    // the done items that dominate the file by count. (Flow-task sections
    // like `## Fix failing CI checks` are intentionally skipped by
    // parseSubtasks — see its doc comment — so the freshly prepended
    // unchecked work lives under a regular mission heading.)
    const completed = Array.from({ length: 16 }, (_, i) => `- [x] old done ${i + 1}`).join("\n");
    const tasksMd = [
      "# Tasks",
      "",
      "## Implementation",
      "- [ ] newly added unfinished task",
      completed,
      "- [ ] previous unfinished mission task",
      "",
    ].join("\n");
    const parsed = parseSubtasks(tasksMd);
    const ordered = orderSubtasksForCappedDisplay(parsed).slice(0, 15);
    expect(ordered[0]).toEqual({ done: false, text: "newly added unfinished task" });
    expect(ordered[1]).toEqual({ done: false, text: "previous unfinished mission task" });
    // The remaining 13 slots are completed items — unchecked tasks are
    // never displaced by completed items even though done items dominate
    // the file by count.
    expect(ordered.slice(2).every((s) => s.done)).toBe(true);
  });
});
