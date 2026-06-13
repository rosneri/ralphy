import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  canonicalWireLiterals,
  discriminantLiterals,
  extractTypeAliases,
  findViolations,
  isExcludedTestPath,
  MIN_OVERLAP,
} from "../check-event-union";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("extractTypeAliases (brace-aware RHS capture)", () => {
  test("captures the full union body past `;` separators inside arms", () => {
    const src = `export type E =\n  | { type: "a"; ts: number }\n  | { type: "b"; ok: boolean };\nconst after = 1;`;
    const aliases = extractTypeAliases(src);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]?.name).toBe("E");
    // The inner `;` after `ts: number` must NOT have terminated the body.
    expect(aliases[0]?.body).toContain(`type: "b"`);
    expect(aliases[0]?.body).not.toContain("const after");
  });
});

describe("discriminantLiterals", () => {
  test("collects distinct `type:` string literals, including the collapsed form", () => {
    const body = `{ type: "x" } | { type: "y" | "z" } | { type: "x" }`;
    expect(discriminantLiterals(body).sort()).toEqual(["x", "y", "z"]);
  });

  test("ignores non-`type` properties", () => {
    expect(discriminantLiterals(`{ kind: "nope"; type: "yes" }`)).toEqual(["yes"]);
  });
});

describe("isExcludedTestPath", () => {
  test("excludes *.test.ts(x) and __tests__/ paths", () => {
    expect(isExcludedTestPath("apps/ui/src/foo.test.ts")).toBe(true);
    expect(isExcludedTestPath("apps/ui/src/foo.test.tsx")).toBe(true);
    expect(isExcludedTestPath("packages/core/src/__tests__/bar.ts")).toBe(true);
  });

  test("includes production source", () => {
    expect(isExcludedTestPath("packages/events/src/types.ts")).toBe(false);
  });
});

describe("guard over the real tree", () => {
  test("derives a non-trivial canonical wire vocabulary from the two homes", async () => {
    const canon = await canonicalWireLiterals(REPO_ROOT);
    // Sanity: the canonical homes really define the wire literals we derive from.
    expect(canon.has("command_run")).toBe(true); // RalphEvent
    expect(canon.has("iteration-finished")).toBe(true); // LoopRunnerEvent
    expect(canon.size).toBeGreaterThan(MIN_OVERLAP);
  });

  test("the clean tree has zero violations (guard exits clean)", async () => {
    expect(await findViolations(REPO_ROOT)).toEqual([]);
  });
});

describe("the matcher FAILS on a deliberately-rogue copy", () => {
  test("a foreign union re-declaring canonical wire literals is flagged", async () => {
    const canon = await canonicalWireLiterals(REPO_ROOT);
    // Build a rogue union from real canonical literals — a 5th wire copy.
    const wire = [...canon];
    const rogue = `export type RogueStreamEvent =\n  | { type: "${wire[0]}" }\n  | { type: "${wire[1]}" };`;
    const overlap = discriminantLiterals(extractTypeAliases(rogue)[0]?.body ?? "").filter((l) =>
      canon.has(l),
    );
    expect(overlap.length).toBeGreaterThanOrEqual(MIN_OVERLAP);
  });

  test("a union sharing only ONE canonical literal stays below threshold (no false positive)", async () => {
    const canon = await canonicalWireLiterals(REPO_ROOT);
    const wire = [...canon];
    const benign = `type Thing = { type: "${wire[0]}" } | { type: "toggleFocus" };`;
    const overlap = discriminantLiterals(extractTypeAliases(benign)[0]?.body ?? "").filter((l) =>
      canon.has(l),
    );
    expect(overlap.length).toBeLessThan(MIN_OVERLAP);
  });
});
