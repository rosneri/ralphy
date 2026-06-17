import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  classifyToken,
  collectSourceFiles,
  compareToBaseline,
  extractOccurrences,
  isExcludedTestPath,
  makePairKey,
  scanTree,
  tokenize,
} from "../check-no-abbreviation";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", ".abbreviation-baseline.json");

describe("tokenize", () => {
  test("splits camelCase", () => {
    expect(tokenize("repoRoot")).toEqual(["repo", "root"]);
  });

  test("splits PascalCase", () => {
    expect(tokenize("ConfigStore")).toEqual(["config", "store"]);
  });

  test("splits acronym runs", () => {
    expect(tokenize("parseURL")).toEqual(["parse", "url"]);
    expect(tokenize("URLParser")).toEqual(["url", "parser"]);
  });

  test("splits snake_case and other separators", () => {
    expect(tokenize("tmp_dir")).toEqual(["tmp", "dir"]);
    expect(tokenize("a-b.c")).toEqual(["a", "b", "c"]);
  });

  test("splits digit groups", () => {
    expect(tokenize("cfg2")).toEqual(["cfg", "2"]);
  });

  test("lowercases tokens", () => {
    expect(tokenize("CFG")).toEqual(["cfg"]);
  });
});

describe("classifyToken", () => {
  test("maps each denylist token to its suggestion", () => {
    expect(classifyToken("cfg")).toBe("config");
    expect(classifyToken("tmp")).toBe("temporary");
    expect(classifyToken("msg")).toBe("message");
    expect(classifyToken("idx")).toBe("index");
    expect(classifyToken("acc")).toBe("account/accumulator");
    expect(classifyToken("pct")).toBe("percentage");
    expect(classifyToken("repo")).toBe("repository");
    expect(classifyToken("doc")).toBe("document");
  });

  test("returns null for full words that merely contain an abbreviation as a substring", () => {
    expect(classifyToken("config")).toBeNull();
    expect(classifyToken("repository")).toBeNull();
    expect(classifyToken("accounting")).toBeNull();
    expect(classifyToken("report")).toBeNull();
    expect(classifyToken("document")).toBeNull();
  });
});

describe("extractOccurrences", () => {
  test("flags a `const cfg` declaration", () => {
    const occurrences = extractOccurrences(`const cfg = 1;`);
    expect(occurrences).toEqual([{ token: "cfg", line: 1, suggestion: "config" }]);
  });

  test("flags a `getRepo` function name", () => {
    const occurrences = extractOccurrences(`function getRepo() {}`);
    expect(occurrences).toEqual([{ token: "repo", line: 1, suggestion: "repository" }]);
  });

  test("flags a destructured `{ msg }` binding", () => {
    const occurrences = extractOccurrences(`const { msg } = event;`);
    expect(occurrences).toEqual([{ token: "msg", line: 1, suggestion: "message" }]);
  });

  test("flags a parameter named `idx`", () => {
    const occurrences = extractOccurrences(`function at(idx) { return idx; }`);
    expect(occurrences).toEqual([{ token: "idx", line: 1, suggestion: "index" }]);
  });

  test("ignores a full word like `configuration`", () => {
    expect(extractOccurrences(`const configuration = 1;`)).toEqual([]);
  });

  test("ignores an object-literal key `{ cfg: 1 }`", () => {
    expect(extractOccurrences(`const value = { cfg: 1 };`)).toEqual([]);
  });

  test("ignores a member access `x.tmp`", () => {
    expect(extractOccurrences(`const value = x.tmp;`)).toEqual([]);
  });

  test("ignores comment text mentioning cfg", () => {
    expect(extractOccurrences(`// load the cfg here\nconst loaded = 1;`)).toEqual([]);
  });

  test("ignores import binding names", () => {
    expect(extractOccurrences(`import { cfg } from "./other";`)).toEqual([]);
  });

  test("reports the real line of a later declaration", () => {
    const occurrences = extractOccurrences(`const ok = 1;\n\nconst cfg = 2;`);
    expect(occurrences).toEqual([{ token: "cfg", line: 3, suggestion: "config" }]);
  });

  test("returns an empty array for unparseable source", () => {
    expect(extractOccurrences(`const = = =;`)).toEqual([]);
  });
});

describe("compareToBaseline", () => {
  test("a new pair not in the baseline is a violation", () => {
    const result = compareToBaseline(["a.ts\tcfg"], []);
    expect(result.newViolations).toEqual(["a.ts\tcfg"]);
    expect(result.staleEntries).toEqual([]);
  });

  test("a baselined pair passes", () => {
    const result = compareToBaseline(["a.ts\tcfg"], ["a.ts\tcfg"]);
    expect(result.newViolations).toEqual([]);
    expect(result.staleEntries).toEqual([]);
  });

  test("a baseline pair no longer present is stale", () => {
    const result = compareToBaseline([], ["a.ts\tcfg"]);
    expect(result.newViolations).toEqual([]);
    expect(result.staleEntries).toEqual(["a.ts\tcfg"]);
  });
});

describe("isExcludedTestPath", () => {
  test("excludes test and spec files and __tests__ dirs", () => {
    expect(isExcludedTestPath("packages/x/src/foo.test.ts")).toBe(true);
    expect(isExcludedTestPath("packages/x/src/foo.spec.tsx")).toBe(true);
    expect(isExcludedTestPath("scripts/__tests__/foo.ts")).toBe(true);
  });

  test("includes ordinary source files", () => {
    expect(isExcludedTestPath("packages/x/src/foo.ts")).toBe(false);
  });
});

describe("live tree guard", () => {
  test("every baselined pair still exists and still violates", async () => {
    const baseline = (await Bun.file(BASELINE_PATH).json()) as string[];
    const pairs = await scanTree(REPO_ROOT);
    for (const key of baseline) {
      expect(pairs.has(key), `${key} is baselined but no longer appears — remove it`).toBe(true);
    }
  });

  test("no in-scope file produces a pair outside the baseline", async () => {
    const baseline = new Set((await Bun.file(BASELINE_PATH).json()) as string[]);
    const pairs = await scanTree(REPO_ROOT);
    const offenders = [...pairs.keys()].filter((key) => !baseline.has(key));
    expect(offenders, `new pairs not in baseline: ${offenders.join(", ")}`).toEqual([]);
  });

  test("collectSourceFiles excludes test files and finds sources", async () => {
    const files = await collectSourceFiles(REPO_ROOT);
    expect(files.every((file) => !isExcludedTestPath(file))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  test("makePairKey composes the baseline key format", () => {
    expect(makePairKey("a/b.ts", "cfg")).toBe("a/b.ts\tcfg");
  });
});
