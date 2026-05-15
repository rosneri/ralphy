import { describe, it, expect } from "bun:test";
import { parsePendingTasks } from "../components/AgentMode";

describe("parsePendingTasks", () => {
  it("returns all unchecked items in document order", () => {
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
    expect(parsePendingTasks(md)).toEqual(["first pending", "second pending", "third pending"]);
  });

  it("returns an empty array when nothing is pending", () => {
    expect(parsePendingTasks("- [x] one\n- [x] two\n")).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parsePendingTasks("")).toEqual([]);
  });

  it("trims whitespace on items", () => {
    expect(parsePendingTasks("- [ ]   spaced item   ")).toEqual(["spaced item"]);
  });

  it("ignores non-task lines", () => {
    const md = "Some prose\n- [ ] real task\nMore prose\n* [ ] not a task\n";
    expect(parsePendingTasks(md)).toEqual(["real task"]);
  });
});
