#!/usr/bin/env bun
/**
 * Event-wire drift guard (RLF-254).
 *
 * RLF-254 unified four hand-rolled copies of the event wire-format into two
 * canonical discriminated unions:
 *
 *   - `RalphEvent`      in packages/events/src/types.ts        (the capture/JSONL wire)
 *   - `LoopRunnerEvent` in packages/core/src/loop-runner/index.ts (the task-stream wire)
 *
 * This guard prevents a fifth copy from drifting back in. It derives the set of
 * canonical discriminant `type:` string literals from those two homes, then
 * scans every other production source file for a `type … = …` alias whose union
 * arms re-declare those same wire literals. Re-using the canonical wire names in
 * a *new* union is the exact shape of a re-introduced copy.
 *
 * Why literal-overlap and not bare shape detection: the tree has legitimate
 * `type:`-keyed unions that are NOT the event wire — XState machine events
 * (`FlowEvent` → CONFLICT_DETECTED, …) and reducer actions (`FieldAction` →
 * toggleFocus, …). Those share zero literals with the canonical wire, so they
 * pass. Only a union that copies the wire vocabulary trips the guard.
 *
 * Consumers are unaffected: a `switch (event.type) { case "feed": … }` reads the
 * canonical union and declares no competing alias, so it is never flagged.
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`. No node:fs.
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * The two canonical wire homes (relative to the repo root). Their unions are the
 * source of truth from which the guarded literal vocabulary is derived, so they
 * are never themselves flagged.
 */
export const CANONICAL_HOMES = [
  { file: "packages/events/src/types.ts", union: "RalphEvent" },
  { file: "packages/core/src/loop-runner/index.ts", union: "LoopRunnerEvent" },
] as const;

/** Globs (relative to the repo root) selecting production source to scan. */
export const SCANNED_GLOBS = [
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
  "apps/*/src/**/*.ts",
  "apps/*/src/**/*.tsx",
];

/**
 * Minimum number of distinct canonical wire literals a foreign union must
 * re-declare to count as a copy. Two avoids tripping on a lone generic
 * discriminant (e.g. an unrelated union with a single `type: "info"` arm) while
 * still catching any genuine re-introduction of the wire, which carries many.
 */
export const MIN_OVERLAP = 2;

/** Test files are out of scope — they legitimately mock wire shapes. */
export function isExcludedTestPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return /\.test\.tsx?$/.test(normalized) || normalized.split("/").includes("__tests__");
}

/**
 * Capture the right-hand side of the type alias named `name` (or, when `name` is
 * undefined, the alias that starts at `fromIndex`). Brace-aware: the union RHS
 * runs from `=` to the first `;` seen at bracket-depth 0, so the `;` separators
 * *inside* each object-literal arm (`{ type: "x"; ts: number }`) do not end it.
 */
function captureAliasBody(source: string, startAfterEquals: number): string {
  let depth = 0;
  let i = startAfterEquals;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{" || c === "(" || c === "[" || c === "<") depth += 1;
    else if (c === "}" || c === ")" || c === "]" || c === ">") depth -= 1;
    else if (c === ";" && depth === 0) break;
  }
  return source.slice(startAfterEquals, i);
}

export interface TypeAlias {
  name: string;
  body: string;
}

/** Every `type Name = …;` alias in `source`, with its brace-aware RHS body. */
export function extractTypeAliases(source: string): TypeAlias[] {
  const aliases: TypeAlias[] = [];
  const aliasRe = /(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*=/g;
  for (const match of source.matchAll(aliasRe)) {
    const name = match[1] ?? "";
    const body = captureAliasBody(source, (match.index ?? 0) + match[0].length);
    aliases.push({ name, body });
  }
  return aliases;
}

/**
 * The distinct string literals assigned to a `type:` discriminant inside a union
 * body — including the `type: "a" | "b"` collapsed form. These are the wire
 * vocabulary of the union.
 */
export function discriminantLiterals(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\btype\s*:\s*((?:["'][^"']+["']\s*\|?\s*)+)/g)) {
    for (const lit of match[1]?.match(/["']([^"']+)["']/g) ?? []) {
      found.add(lit.replaceAll(/["']/g, ""));
    }
  }
  return [...found];
}

/** Derive the canonical wire vocabulary from the two homes' union declarations. */
export async function canonicalWireLiterals(root: string): Promise<Set<string>> {
  const literals = new Set<string>();
  for (const { file, union } of CANONICAL_HOMES) {
    const source = await Bun.file(join(root, file)).text();
    const alias = extractTypeAliases(source).find((a) => a.name === union);
    for (const lit of discriminantLiterals(alias?.body ?? "")) literals.add(lit);
  }
  return literals;
}

/** Production source files in scope, sorted and de-duplicated. */
export async function collectScannedFiles(root: string): Promise<string[]> {
  const set = new Set<string>();
  for (const pattern of SCANNED_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root })) {
      if (isExcludedTestPath(rel)) continue;
      set.add(rel.replaceAll("\\", "/"));
    }
  }
  return [...set].sort();
}

export interface Violation {
  file: string;
  union: string;
  overlap: string[];
}

/**
 * Scan the production tree and return every foreign type alias whose union
 * re-declares at least `MIN_OVERLAP` canonical wire literals. The two canonical
 * homes are skipped — they ARE the source of the vocabulary.
 */
export async function findViolations(root: string): Promise<Violation[]> {
  const canon = await canonicalWireLiterals(root);
  const homes = new Set<string>(CANONICAL_HOMES.map((h) => h.file));
  const violations: Violation[] = [];
  for (const rel of await collectScannedFiles(root)) {
    if (homes.has(rel)) continue;
    const source = await Bun.file(join(root, rel)).text();
    for (const alias of extractTypeAliases(source)) {
      const overlap = discriminantLiterals(alias.body).filter((l) => canon.has(l));
      if (overlap.length >= MIN_OVERLAP) {
        violations.push({ file: rel, union: alias.name, overlap });
      }
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const violations = await findViolations(REPO_ROOT);

  if (violations.length === 0) {
    console.log("✓ No re-introduced copies of the canonical event wire");
    return;
  }

  console.error(
    `✘ Found ${violations.length} union(s) re-declaring canonical event-wire literals:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file} → type ${v.union} re-uses: ${v.overlap.join(", ")}`);
  }
  console.error(
    "\nThe event wire-format has exactly two canonical homes:\n" +
      "  - RalphEvent      in packages/events/src/types.ts\n" +
      "  - LoopRunnerEvent in packages/core/src/loop-runner/index.ts\n" +
      "Import and extend those unions instead of hand-rolling a copy. See\n" +
      "scripts/check-event-union.ts.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
