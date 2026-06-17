import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  appendBounded,
  truncateForDisplay,
  MAX_RETAINED_LOG_ENTRIES,
  MAX_FEED_TEXT_CHARS,
} from "../log-retention";

// Root cause of the recurring 16G OOM: a worker iteration that streams
// high-volume engine output retained every feed event unboundedly
// (apps/loop useLoop `setLogLines((prev) => [...prev, ...entries])`) and held
// each entry's full text, then Ink measured/wrapped it. These helpers bound
// both axes: the number of retained entries, and the size of any one entry.
describe("log-retention — bounded feed retention (OOM fix)", () => {
  describe("appendBounded — caps retained entry count", () => {
    test("the bug: a naive spread accumulator is unbounded", () => {
      // Documents the broken pattern the fix replaces.
      let acc: number[] = [];
      for (let i = 0; i < MAX_RETAINED_LOG_ENTRIES * 3; i++) {
        acc = [...acc, i];
      }
      expect(acc.length).toBe(MAX_RETAINED_LOG_ENTRIES * 3);
    });

    test("the fix: retention never exceeds the cap", () => {
      let state: number[] = [];
      let totalDropped = 0;
      for (let i = 0; i < MAX_RETAINED_LOG_ENTRIES * 3; i++) {
        const r = appendBounded(state, [i]);
        state = r.entries;
        totalDropped += r.dropped;
      }
      expect(state.length).toBe(MAX_RETAINED_LOG_ENTRIES);
      expect(totalDropped).toBeGreaterThan(0);
    });

    test("keeps the most-recent entries when it trims", () => {
      const prev = Array.from({ length: MAX_RETAINED_LOG_ENTRIES }, (_, i) => i);
      const r = appendBounded(prev, [9001, 9002], 5);
      expect(r.entries).toEqual([
        MAX_RETAINED_LOG_ENTRIES - 3,
        MAX_RETAINED_LOG_ENTRIES - 2,
        MAX_RETAINED_LOG_ENTRIES - 1,
        9001,
        9002,
      ]);
      expect(r.dropped).toBe(MAX_RETAINED_LOG_ENTRIES - 3);
    });

    test("no trim, no copy churn when under the cap", () => {
      const prev = [1, 2, 3];
      const r = appendBounded(prev, [4], 10);
      expect(r.entries).toEqual([1, 2, 3, 4]);
      expect(r.dropped).toBe(0);
    });

    test("appending nothing is a no-op that keeps the same reference", () => {
      const prev = [1, 2, 3];
      const r = appendBounded(prev, [], 10);
      expect(r.entries).toBe(prev);
      expect(r.dropped).toBe(0);
    });
  });

  describe("truncateForDisplay — caps a single entry's text size", () => {
    test("short text passes through unchanged", () => {
      expect(truncateForDisplay("hello", 100)).toBe("hello");
    });

    test("the fix: oversized text is truncated with a marker", () => {
      const huge = "x".repeat(MAX_FEED_TEXT_CHARS * 4);
      const out = truncateForDisplay(huge);
      expect(out.length).toBeLessThan(huge.length);
      expect(out.length).toBeLessThanOrEqual(MAX_FEED_TEXT_CHARS + 64);
      expect(out).toContain("truncated");
    });

    test("boundary: text exactly at the cap is not truncated", () => {
      const exact = "y".repeat(MAX_FEED_TEXT_CHARS);
      expect(truncateForDisplay(exact)).toBe(exact);
    });
  });

  describe("production wiring", () => {
    const SRC_DIR = import.meta.dir.replace("/dist/src/", "/src/");

    test("useLoop bounds logLines retention (no raw unbounded spread)", async () => {
      const p = join(SRC_DIR, "..", "..", "..", "..", "apps", "loop", "src", "hooks", "useLoop.ts");
      const text = await Bun.file(p).text();
      expect(text.includes("appendBounded")).toBe(true);
      // the unbounded pattern must be gone
      expect(/setLogLines\(\(previous\) => \[\.\.\.previous, \.\.\.entries\]\)/.test(text)).toBe(
        false,
      );
    });

    test("AgentMode bounds coordinator logs retention", async () => {
      const p = join(
        SRC_DIR,
        "..",
        "..",
        "..",
        "..",
        "apps",
        "agent",
        "src",
        "components",
        "AgentMode.tsx",
      );
      const text = await Bun.file(p).text();
      expect(text.includes("appendBounded")).toBe(true);
    });
  });
});
