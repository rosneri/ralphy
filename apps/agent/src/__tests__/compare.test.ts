import { describe, expect, test } from "bun:test";
import { chain, type Comparator } from "../sort/compare";

describe("chain", () => {
  test("first non-zero comparator wins", () => {
    const cmp = chain<number>(
      () => 0,
      (a, b) => a - b,
    );
    expect(cmp(1, 2)).toBeLessThan(0);
    expect(cmp(3, 2)).toBeGreaterThan(0);
  });

  test("returns 0 when every comparator ties", () => {
    const tie: Comparator<string> = () => 0;
    const cmp = chain<string>(tie, tie, tie);
    expect(cmp("a", "b")).toBe(0);
  });

  test("empty chain is a stable no-op (always 0)", () => {
    const cmp = chain<number>();
    expect(cmp(1, 2)).toBe(0);
    expect(cmp(2, 1)).toBe(0);
  });
});
