import { describe, expect, test } from "bun:test";
import { allChecked, hasUnchecked, planningComplete } from "../detections/tasks";

describe("hasUnchecked", () => {
  test("empty string → false", () => {
    expect(hasUnchecked("")).toBe(false);
  });
  test("only checked items → false", () => {
    expect(hasUnchecked("- [x] done\n- [x] also done\n")).toBe(false);
  });
  test("mixed items → true", () => {
    expect(hasUnchecked("- [x] done\n- [ ] pending\n")).toBe(true);
  });
  test("only unchecked → true", () => {
    expect(hasUnchecked("- [ ] pending\n")).toBe(true);
  });
});

describe("allChecked", () => {
  test("empty string → false", () => {
    expect(allChecked("")).toBe(false);
  });
  test("whitespace-only → false", () => {
    expect(allChecked("   \n\t\n")).toBe(false);
  });
  test("only checked items → true", () => {
    expect(allChecked("- [x] done\n- [x] also done\n")).toBe(true);
  });
  test("mixed items → false", () => {
    expect(allChecked("- [x] done\n- [ ] pending\n")).toBe(false);
  });
});

describe("planningComplete", () => {
  test("no Planning section → true (not blocking)", () => {
    expect(planningComplete("# Tasks\n\n## Implementation\n\n- [ ] do the thing\n")).toBe(true);
  });
  test("empty string → true (not blocking)", () => {
    expect(planningComplete("")).toBe(true);
  });
  test("Planning section with all checked → true", () => {
    const md =
      "# Tasks\n\n## Planning\n\n- [x] research\n- [x] write proposal\n\n## Implementation\n\n- [ ] do it\n";
    expect(planningComplete(md)).toBe(true);
  });
  test("Planning section with unchecked items → false", () => {
    const md =
      "# Tasks\n\n## Planning\n\n- [x] done\n- [ ] still todo\n\n## Implementation\n\n- [ ] do it\n";
    expect(planningComplete(md)).toBe(false);
  });
  test("Planning section entirely unchecked → false", () => {
    const md = "# Tasks\n\n## Planning\n\n- [ ] first\n- [ ] second\n";
    expect(planningComplete(md)).toBe(false);
  });
  test("Planning section with uppercase X → true", () => {
    expect(planningComplete("## Planning\n\n- [X] done\n")).toBe(true);
  });
  test("only Planning section, no Implementation → true when all checked", () => {
    expect(planningComplete("## Planning\n\n- [x] all done\n")).toBe(true);
  });
});
