import { describe, it, expect } from "bun:test";
import { parseSubtasks } from "../components/AgentMode";

describe("parseSubtasks", () => {
  it("returns all done and pending items in document order", () => {
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
      { done: true, text: "done thing" },
      { done: false, text: "first pending" },
      { done: false, text: "second pending" },
      { done: true, text: "another done" },
      { done: false, text: "third pending" },
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
