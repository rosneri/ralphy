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

  it("keeps a freshly prepended Fix failing CI task on top once the cap (15) kicks in", () => {
    // Parse a tasks.md that has a freshly prepended Fix-failing-CI section
    // sitting above a long run of completed items. The capped panel slices
    // the *ordered* list to 15 — that slice must include the new pending
    // task, never get crowded out by the done items above it in the file.
    const completed = Array.from({ length: 16 }, (_, i) => `- [x] old done ${i + 1}`).join("\n");
    const tasksMd = [
      "# Tasks",
      "",
      "## Fix failing CI checks (2026-05-15T00:00:00.000Z)",
      "- [ ] Fix failing CI checks. Read the error block below…",
      "",
      "## Implementation",
      completed,
      "- [ ] previous unfinished mission task",
      "",
    ].join("\n");
    const parsed = parseSubtasks(tasksMd);
    const ordered = orderSubtasksForCappedDisplay(parsed).slice(0, 15);
    expect(ordered[0]).toEqual({
      done: false,
      text: "Fix failing CI checks. Read the error block below…",
    });
    expect(ordered[1]).toEqual({ done: false, text: "previous unfinished mission task" });
    // The remaining 13 slots are completed items — unchecked tasks are
    // never displaced by completed items even though done items dominate
    // the file by count.
    expect(ordered.slice(2).every((s) => s.done)).toBe(true);
  });
});
