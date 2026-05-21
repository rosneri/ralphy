import { describe, expect, it } from "bun:test";
import { add } from "./add";

describe("add", () => {
  it("adds two positive numbers", () => {
    expect(add(1, 2)).toBe(3);
  });

  it("returns zero when both operands are zero", () => {
    expect(add(0, 0)).toBe(0);
  });

  it("returns zero when operands cancel", () => {
    expect(add(-1, 1)).toBe(0);
  });
});
