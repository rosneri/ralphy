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
