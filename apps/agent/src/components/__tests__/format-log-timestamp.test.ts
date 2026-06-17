import { describe, expect, test } from "bun:test";
import { formatLogTimestamp } from "../useBoundedLogs";

describe("formatLogTimestamp", () => {
  test("renders local wall-clock time as zero-padded HH:MM:SS", () => {
    const date = new Date(2026, 5, 10, 9, 5, 3);
    expect(formatLogTimestamp(date)).toBe("09:05:03");
  });

  test("handles end-of-day values without padding artifacts", () => {
    const date = new Date(2026, 5, 10, 23, 59, 59);
    expect(formatLogTimestamp(date)).toBe("23:59:59");
  });
});
