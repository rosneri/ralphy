import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  collectSourceFiles,
  computeUpdatedBaseline,
  countLines,
  findViolations,
  isExcluded,
  MAX_LINES,
} from "../check-file-size";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("countLines", () => {
  test("counts N lines for N-line text with a trailing newline", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
  });

  test("counts N lines for N-line text without a trailing newline", () => {
    expect(countLines("a\nb\nc")).toBe(3);
  });

  test("empty file is zero lines", () => {
    expect(countLines("")).toBe(0);
  });
});

describe("isExcluded", () => {
  test("excludes *.test.ts(x) and *.spec.ts(x)", () => {
    expect(isExcluded("apps/agent/src/foo.test.ts")).toBe(true);
    expect(isExcluded("apps/agent/src/Foo.test.tsx")).toBe(true);
    expect(isExcluded("apps/agent/src/foo.spec.ts")).toBe(true);
  });

  test("excludes __tests__/, dist/, generated/, __fixtures__/ segments", () => {
    expect(isExcluded("apps/agent/src/__tests__/foo.ts")).toBe(true);
    expect(isExcluded("packages/core/dist/index.ts")).toBe(true);
    expect(isExcluded("packages/types/src/generated/api.ts")).toBe(true);
    expect(isExcluded("apps/agent/src/__fixtures__/sample.ts")).toBe(true);
  });

  test("includes production source", () => {
    expect(isExcluded("apps/agent/src/runtime/coordinator.ts")).toBe(false);
    expect(isExcluded("packages/core/src/loop.ts")).toBe(false);
  });
});

describe("findViolations", () => {
  const max = 400;

  test("new file over budget fails", () => {
    const sizes = { "a.ts": 500 };
    const v = findViolations(sizes, {}, max);
    expect(v).toEqual([{ file: "a.ts", lines: 500, baseline: null }]);
  });

  test("baselined file that grew fails", () => {
    const sizes = { "a.ts": 520 };
    const v = findViolations(sizes, { "a.ts": 500 }, max);
    expect(v).toEqual([{ file: "a.ts", lines: 520, baseline: 500 }]);
  });

  test("baselined file that shrank but stays over budget passes", () => {
    const sizes = { "a.ts": 480 };
    expect(findViolations(sizes, { "a.ts": 500 }, max)).toEqual([]);
  });

  test("baselined file unchanged passes", () => {
    const sizes = { "a.ts": 500 };
    expect(findViolations(sizes, { "a.ts": 500 }, max)).toEqual([]);
  });

  test("under-budget file passes", () => {
    expect(findViolations({ "a.ts": 399 }, {}, max)).toEqual([]);
  });

  test("file exactly at budget passes (strict >)", () => {
    expect(findViolations({ "a.ts": 400 }, {}, max)).toEqual([]);
  });
});

describe("computeUpdatedBaseline", () => {
  const max = 400;

  test("lowers a shrunk entry to the new count", () => {
    const updated = computeUpdatedBaseline({ "a.ts": 450 }, { "a.ts": 500 }, max);
    expect(updated).toEqual({ "a.ts": 450 });
  });

  test("never raises a grown entry above its recorded count", () => {
    const updated = computeUpdatedBaseline({ "a.ts": 600 }, { "a.ts": 500 }, max);
    expect(updated).toEqual({ "a.ts": 500 });
  });

  test("drops a file that fell to/below budget", () => {
    const updated = computeUpdatedBaseline({ "a.ts": 400 }, { "a.ts": 500 }, max);
    expect(updated).toEqual({});
  });

  test("adds a new over-budget file", () => {
    const updated = computeUpdatedBaseline({ "a.ts": 500 }, {}, max);
    expect(updated).toEqual({ "a.ts": 500 });
  });
});

describe("collectSourceFiles over the real tree", () => {
  test("returns paths and excludes tests / __tests__/", async () => {
    const files = await collectSourceFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("packages/core/src/loop.ts");
    expect(files.some((f) => f.includes("__tests__"))).toBe(false);
    expect(files.some((f) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(f))).toBe(false);
  });

  test("MAX_LINES is 400", () => {
    expect(MAX_LINES).toBe(400);
  });
});
