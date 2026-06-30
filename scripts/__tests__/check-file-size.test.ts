import { describe, expect, test } from "bun:test";

import { countLines, findViolations, isExcluded, MAX_LINES } from "../check-file-size";

describe("countLines", () => {
  test("empty text counts as zero", () => {
    expect(countLines("")).toBe(0);
  });

  test("single line without trailing newline", () => {
    expect(countLines("one")).toBe(1);
  });

  test("ignores a single trailing newline", () => {
    expect(countLines("one\ntwo\n")).toBe(2);
  });

  test("counts blank rows between content", () => {
    expect(countLines("one\n\nthree")).toBe(3);
  });
});

describe("isExcluded", () => {
  test("excludes test files", () => {
    expect(isExcluded("apps/agent/src/foo.test.ts")).toBe(true);
    expect(isExcluded("packages/core/src/foo.spec.tsx")).toBe(true);
  });

  test("excludes generated, dist, and __tests__ segments", () => {
    expect(isExcluded("apps/agent/src/__tests__/foo.ts")).toBe(true);
    expect(isExcluded("packages/core/dist/foo.ts")).toBe(true);
    expect(isExcluded("packages/core/src/generated/foo.ts")).toBe(true);
  });

  test("keeps ordinary source files", () => {
    expect(isExcluded("apps/agent/src/foo.ts")).toBe(false);
  });
});

describe("findViolations", () => {
  test("flags only files over the cap", () => {
    const sizes = {
      "a.ts": MAX_LINES,
      "b.ts": MAX_LINES + 1,
      "c.ts": MAX_LINES + 50,
    };
    expect(findViolations(sizes, MAX_LINES)).toEqual([
      { file: "b.ts", lines: MAX_LINES + 1 },
      { file: "c.ts", lines: MAX_LINES + 50 },
    ]);
  });

  test("returns nothing when all files are within the cap", () => {
    expect(findViolations({ "a.ts": 1, "b.ts": MAX_LINES }, MAX_LINES)).toEqual([]);
  });

  test("sorts violations by path", () => {
    const sizes = { "z.ts": MAX_LINES + 1, "a.ts": MAX_LINES + 1 };
    expect(findViolations(sizes, MAX_LINES).map((violation) => violation.file)).toEqual([
      "a.ts",
      "z.ts",
    ]);
  });
});
