import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  classifyBinding,
  collectSourceFiles,
  findViolations,
  isExcludedTestPath,
  scanTree,
} from "../check-bun-native";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("findViolations (the matcher)", () => {
  test("FLAGS a *Sync named import from node:fs", () => {
    const src = `import { readFileSync } from "node:fs";`;
    expect(findViolations(src)).toEqual([{ kind: "fs-sync", binding: "readFileSync", line: 1 }]);
  });

  test("FLAGS createHash from node:crypto", () => {
    const src = `import { createHash } from "node:crypto";`;
    expect(findViolations(src)).toEqual([
      { kind: "crypto-createHash", binding: "createHash", line: 1 },
    ]);
  });

  test("FLAGS the deprecated exists from node:fs/promises", () => {
    const src = `import { exists } from "node:fs/promises";`;
    expect(findViolations(src)).toEqual([
      { kind: "fs-promises-exists", binding: "exists", line: 1 },
    ]);
  });

  test("ALLOWS createWriteStream from node:fs — not a *Sync API", () => {
    const src = `import { createWriteStream, type WriteStream } from "node:fs";`;
    expect(findViolations(src)).toEqual([]);
  });

  test("ALLOWS async node:fs/promises functions other than exists", () => {
    const src = `import { mkdir, rm, readFile, readdir } from "node:fs/promises";`;
    expect(findViolations(src)).toEqual([]);
  });

  test("ALLOWS randomUUID from node:crypto — only createHash is banned", () => {
    const src = `import { randomUUID } from "node:crypto";`;
    expect(findViolations(src)).toEqual([]);
  });

  test("flags every *Sync binding in a multi-line import and reports its real line", () => {
    const src = [
      `import {`, // 1
      `  readFileSync,`, // 2
      `  writeFileSync,`, // 3
      `  existsSync,`, // 4
      `} from "node:fs";`, // 5
    ].join("\n");
    expect(findViolations(src)).toEqual([
      { kind: "fs-sync", binding: "readFileSync", line: 2 },
      { kind: "fs-sync", binding: "writeFileSync", line: 3 },
      { kind: "fs-sync", binding: "existsSync", line: 4 },
    ]);
  });

  test("inspects the original binding, not the alias — `readFileSync as rfs` is flagged", () => {
    const src = `import { readFileSync as rfs } from "node:fs";`;
    expect(findViolations(src)).toEqual([{ kind: "fs-sync", binding: "readFileSync", line: 1 }]);
  });

  test("strips an inline `type` modifier on a banned binding", () => {
    const src = `import { type existsSync } from "node:fs";`;
    expect(findViolations(src)).toEqual([{ kind: "fs-sync", binding: "existsSync", line: 1 }]);
  });

  test("ignores `exists` imported from a non-guarded module", () => {
    const src = `import { exists } from "../util/fs";`;
    expect(findViolations(src)).toEqual([]);
  });

  test("does not inspect namespace imports (known v1 gap)", () => {
    const src = `import * as fs from "node:fs";`;
    expect(findViolations(src)).toEqual([]);
  });

  test("computes line numbers when preceded by other lines", () => {
    const src = `// header\n\nimport { createHash } from "node:crypto";`;
    expect(findViolations(src)).toEqual([
      { kind: "crypto-createHash", binding: "createHash", line: 3 },
    ]);
  });
});

describe("classifyBinding", () => {
  test("maps each module/binding pair to its banned kind", () => {
    expect(classifyBinding("node:fs", "mkdirSync")).toBe("fs-sync");
    expect(classifyBinding("node:crypto", "createHash")).toBe("crypto-createHash");
    expect(classifyBinding("node:fs/promises", "exists")).toBe("fs-promises-exists");
  });

  test("returns null for allowed bindings", () => {
    expect(classifyBinding("node:fs", "createWriteStream")).toBeNull();
    expect(classifyBinding("node:fs/promises", "mkdir")).toBeNull();
    expect(classifyBinding("node:crypto", "randomUUID")).toBeNull();
  });
});

describe("isExcludedTestPath", () => {
  test("excludes test and spec files and __tests__ dirs", () => {
    expect(isExcludedTestPath("packages/x/src/foo.test.ts")).toBe(true);
    expect(isExcludedTestPath("packages/x/src/foo.spec.ts")).toBe(true);
    expect(isExcludedTestPath("scripts/__tests__/foo.ts")).toBe(true);
  });

  test("includes ordinary source files", () => {
    expect(isExcludedTestPath("packages/x/src/foo.ts")).toBe(false);
  });
});

describe("live tree guard", () => {
  test("every baselined file still exists and still violates", async () => {
    const baseline = (await Bun.file(
      join(REPO_ROOT, "scripts", ".bun-native-baseline.json"),
    ).json()) as string[];
    for (const rel of baseline) {
      const file = Bun.file(join(REPO_ROOT, rel));
      expect(await file.exists(), `${rel} listed in baseline but missing`).toBe(true);
      const violations = findViolations(await file.text());
      expect(
        violations.length,
        `${rel} is baselined but no longer violates — remove it`,
      ).toBeGreaterThan(0);
    }
  });

  test("no source file outside the baseline violates", async () => {
    const baseline = new Set(
      (await Bun.file(join(REPO_ROOT, "scripts", ".bun-native-baseline.json")).json()) as string[],
    );
    const violating = await scanTree(REPO_ROOT);
    const offenders = violating.map((v) => v.file).filter((f) => !baseline.has(f));
    expect(offenders, `new violators not in baseline: ${offenders.join(", ")}`).toEqual([]);
  });

  test("collectSourceFiles excludes test files", async () => {
    const files = await collectSourceFiles(REPO_ROOT);
    expect(files.every((f) => !isExcludedTestPath(f))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });
});
