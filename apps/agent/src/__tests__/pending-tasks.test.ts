import { describe, it, expect } from "bun:test";
import { parseSubtasks } from "../components/AgentMode";

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
