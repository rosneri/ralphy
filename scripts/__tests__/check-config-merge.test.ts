import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findViolations, scanSource } from "../check-config-merge";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("scanSource (the matcher)", () => {
  test("FLAGS the `args.x || cfg.y` fallback — the falsy-override loss we guard against", () => {
    const src = `const team = args.linearTeam || cfg.linear.team;`;
    const found = scanSource(src, "apps/agent/src/planted.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("args.x || cfg.y");
  });

  test("FLAGS the `|| config.x` variant too", () => {
    const src = `const n = args.concurrency || config.concurrency;`;
    expect(scanSource(src, "apps/agent/src/planted.ts")).toHaveLength(1);
  });

  test("FLAGS an `args.x !== <default>` sentinel comparison", () => {
    const src = `if (args.maxFailures !== 5) { /* ... */ }`;
    const found = scanSource(src, "apps/agent/src/planted.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("args.x !== <default>");
  });

  test("PASSES on a plain `effective` read — the migrated shape", () => {
    const src = `const team = effective.linear.team;`;
    expect(scanSource(src, "apps/agent/src/planted.ts")).toEqual([]);
  });

  test("does NOT flag the anti-pattern when it appears only inside a comment", () => {
    const src = ` * never write args.x || cfg.x for any config-backed key`;
    expect(scanSource(src, "apps/agent/src/planted.ts")).toEqual([]);
  });
});

describe("guard over the real tree", () => {
  test("the migrated apps tree has zero violations (guard exits clean)", async () => {
    expect(await findViolations()).toEqual([]);
  });

  test("findViolations skips __tests__ files (a planted fixture there is never read)", async () => {
    // The guard walks apps/ but excludes __tests__; assert no flagged path is a test.
    const violations = await findViolations(join(REPO_ROOT, "apps"));
    expect(violations.every((v) => !v.file.includes("__tests__"))).toBe(true);
  });
});
