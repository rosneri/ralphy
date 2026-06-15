import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  findViolations,
  isTestPath,
  scanTree,
  skipCounts,
  ZERO_TOLERANCE_KINDS,
} from "../check-test-integrity";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("findViolations (the matcher)", () => {
  test("FLAGS test.only", () => {
    const src = `test.only("focused", () => {});`;
    expect(findViolations(src)).toEqual([{ kind: "only", match: ".only(", line: 1 }]);
  });

  test("FLAGS a bare .only(", () => {
    const src = `describe.only("focused suite", () => {});`;
    expect(findViolations(src)).toEqual([{ kind: "only", match: ".only(", line: 1 }]);
  });

  test("FLAGS jest.mock", () => {
    const src = `jest.mock("../thing");`;
    expect(findViolations(src)).toEqual([{ kind: "jest-mock", match: "jest.mock(", line: 1 }]);
  });

  test("FLAGS mock.module(\"node:child_process\")", () => {
    const src = `mock.module("node:child_process", () => ({}));`;
    expect(findViolations(src)).toEqual([
      { kind: "child-process-mock", match: 'mock.module("node:child_process"', line: 1 },
    ]);
  });

  test("FLAGS mock.module with single quotes and extra whitespace", () => {
    const src = `mock.module ( 'node:child_process', () => ({}));`;
    expect(findViolations(src)).toEqual([
      { kind: "child-process-mock", match: "mock.module ( 'node:child_process'", line: 1 },
    ]);
  });

  test("ALLOWS mock.module of another module", () => {
    const src = `mock.module("./other", () => ({}));`;
    expect(findViolations(src)).toEqual([]);
  });

  test("FLAGS test.skip and counts it as a skip", () => {
    const src = `test.skip("later", () => {});`;
    expect(findViolations(src)).toEqual([{ kind: "skip", match: "test.skip", line: 1 }]);
  });

  test("FLAGS test.skipIf, it.todo, xit and xdescribe", () => {
    const src = [
      `test.skipIf(cond)("a", () => {});`, // 1
      `it.todo("b");`, // 2
      `xit("c", () => {});`, // 3
      `xdescribe("d", () => {});`, // 4
    ].join("\n");
    expect(findViolations(src)).toEqual([
      { kind: "skip", match: "test.skipIf", line: 1 },
      { kind: "skip", match: "it.todo", line: 2 },
      { kind: "skip", match: "xit", line: 3 },
      { kind: "skip", match: "xdescribe", line: 4 },
    ]);
  });

  test("ALLOWS property reads like snapshot.todo / opts.skip (not test declarators)", () => {
    const src = `const a = snapshot.todo; const b = opts.skip; let todo = initial.todo;`;
    expect(findViolations(src)).toEqual([]);
  });

  test("reports the real line for a violation preceded by other lines", () => {
    const src = `// header\n\ntest.only("x", () => {});`;
    expect(findViolations(src)).toEqual([{ kind: "only", match: ".only(", line: 3 }]);
  });
});

describe("isTestPath", () => {
  test("includes test/spec files and __tests__ dirs under apps/ and packages/", () => {
    expect(isTestPath("apps/agent/src/foo.test.ts")).toBe(true);
    expect(isTestPath("packages/core/src/foo.spec.tsx")).toBe(true);
    expect(isTestPath("apps/agent/src/__tests__/bar.ts")).toBe(true);
  });

  test("excludes non-test source and files outside apps//packages/", () => {
    expect(isTestPath("apps/agent/src/foo.ts")).toBe(false);
    expect(isTestPath("scripts/__tests__/foo.test.ts")).toBe(false);
  });
});

describe("skipCounts", () => {
  test("counts only skip-kind violations per file", () => {
    const counts = skipCounts([
      {
        file: "a.test.ts",
        violations: [
          { kind: "skip", match: "test.skip", line: 1 },
          { kind: "skip", match: "it.todo", line: 2 },
          { kind: "only", match: ".only(", line: 3 },
        ],
      },
      { file: "b.test.ts", violations: [{ kind: "only", match: ".only(", line: 1 }] },
    ]);
    expect(counts).toEqual({ "a.test.ts": 2 });
  });
});

describe("baseline / ratchet semantics", () => {
  test("a count above baseline is a new violation", () => {
    const baseline: Record<string, number> = { "a.test.ts": 1 };
    const cur = 2;
    expect(cur > (baseline["a.test.ts"] ?? 0)).toBe(true);
  });

  test("a count below baseline is stale", () => {
    const baseline: Record<string, number> = { "a.test.ts": 2 };
    const cur = 1;
    expect(cur < baseline["a.test.ts"]!).toBe(true);
  });
});

describe("live tree guard", () => {
  test("the three zero-tolerance kinds have zero occurrences in the tree", async () => {
    const scanned = await scanTree(REPO_ROOT);
    const offenders = scanned.flatMap(({ file, violations }) =>
      violations
        .filter((v) => ZERO_TOLERANCE_KINDS.includes(v.kind))
        .map((v) => `${file}:${v.line} ${v.match}`),
    );
    expect(offenders, `forbidden patterns found: ${offenders.join(", ")}`).toEqual([]);
  });

  test("no test file exceeds its baselined skip count", async () => {
    const baseline = (await Bun.file(
      join(REPO_ROOT, "scripts", ".test-skip-baseline.json"),
    ).json()) as Record<string, number>;
    const counts = skipCounts(await scanTree(REPO_ROOT));
    const offenders = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0));
    expect(offenders, `files above baseline: ${offenders.map(([f]) => f).join(", ")}`).toEqual([]);
  });
});
