import { describe, expect, test } from "bun:test";
import { formatReviewCell } from "../list";

describe("formatReviewCell", () => {
  test("returns '-' when prUrl is null (no PR)", () => {
    expect(formatReviewCell(null, undefined)).toBe("-");
    expect(formatReviewCell(null, 3)).toBe("-");
  });

  test("returns digit string when prUrl set and count available", () => {
    expect(formatReviewCell("https://github.com/o/r/pull/1", 3)).toBe("3");
    expect(formatReviewCell("https://github.com/o/r/pull/1", 0)).toBe("0");
  });

  test("returns '-' when prUrl set but count is undefined", () => {
    expect(formatReviewCell("https://github.com/o/r/pull/1", undefined)).toBe("-");
  });
});
