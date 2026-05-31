import { describe, expect, it } from "bun:test";
import { selectNextPickIndex } from "../list";

describe("selectNextPickIndex", () => {
  it("returns -1 for empty array", () => {
    expect(selectNextPickIndex([])).toBe(-1);
  });

  it("returns 0 when first row is unblocked", () => {
    expect(selectNextPickIndex([{ blockedByIdentifiers: [] }])).toBe(0);
  });

  it("skips blocked rows and returns first unblocked index", () => {
    const rows = [
      { blockedByIdentifiers: ["RLF-1"] },
      { blockedByIdentifiers: ["RLF-2"] },
      { blockedByIdentifiers: [] },
    ];
    expect(selectNextPickIndex(rows)).toBe(2);
  });

  it("returns -1 when all rows are blocked", () => {
    const rows = [
      { blockedByIdentifiers: ["RLF-1"] },
      { blockedByIdentifiers: ["RLF-2", "RLF-3"] },
    ];
    expect(selectNextPickIndex(rows)).toBe(-1);
  });
});
