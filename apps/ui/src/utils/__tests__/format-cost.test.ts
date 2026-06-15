import { describe, expect, test } from "bun:test";
import { formatCost } from "../format-cost";

describe("formatCost", () => {
  test("formats whole dollars with two decimals", () => {
    expect(formatCost(5)).toBe("$5.00");
  });

  test("formats zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  test("rounds to the nearest cent", () => {
    expect(formatCost(1.006)).toBe("$1.01");
    expect(formatCost(1.004)).toBe("$1.00");
  });

  test("pads a single-decimal value", () => {
    expect(formatCost(2.5)).toBe("$2.50");
  });

  test("truncates sub-cent precision", () => {
    expect(formatCost(0.129)).toBe("$0.13");
    expect(formatCost(0.121)).toBe("$0.12");
  });
});
