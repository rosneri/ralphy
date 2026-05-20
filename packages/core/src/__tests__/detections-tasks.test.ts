import { describe, expect, test } from "bun:test";
import { allChecked, hasUnchecked } from "../detections/tasks";

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
