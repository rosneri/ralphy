#!/usr/bin/env bun
/**
 * Test-integrity ratchet guard (RLF-263).
 *
 * A handful of test-suite patterns silently erode coverage: focused tests
 * (`.only`) hide every other test in a file, skipped tests stop running, and
 * `jest.mock` / `mock.module("node:child_process")` either don't belong in a
 * Bun project (CLAUDE.md mandates patching `Bun.spawnSync` directly) or quietly
 * defeat the suite. This guard locks the current good state in:
 *
 *   - `only`                — `.only(` (test/describe/it.only, or bare `.only(`)
 *   - `jest-mock`           — `jest.mock(`
 *   - `child-process-mock`  — `mock.module("node:child_process")` (quote /
 *                             whitespace variants)
 *
 *   are ZERO-TOLERANCE: zero exist in the tree today, so any occurrence fails.
 *
 *   - `skip`                — `.skip` / `.skipIf` / `.todo` / `xit` / `xdescribe`
 *
 *   is RATCHETED: a per-file skip *count* baseline in
 *   `scripts/.test-skip-baseline.json` grandfathers existing skips. A file with
 *   *more* skips than its baseline fails; a file with *fewer* is reported stale
 *   (also a failure) so the baseline burns down rather than lingering. Run with
 *   `--update` to regenerate the baseline from the live tree.
 *
 * Only test files under `apps/**` and `packages/**` are scanned
 * (`*.test.ts(x)`, `*.spec.ts(x)`, anything under a `__tests__/` dir). The
 * guard's own fixtures live under `scripts/` and are therefore out of scope.
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`, writes with
 * `Bun.write`. No node:fs.
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", ".test-skip-baseline.json");

/** Globs enumerated when collecting candidate files (relative to repo root). */
export const SCAN_GLOBS = ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"];

export type ViolationKind = "only" | "skip" | "jest-mock" | "child-process-mock";

/** Kinds that must never appear — there are zero in the tree today. */
export const ZERO_TOLERANCE_KINDS: readonly ViolationKind[] = [
  "only",
  "jest-mock",
  "child-process-mock",
];

export interface Violation {
  kind: ViolationKind;
  match: string;
  line: number;
}

const FIX_MESSAGE: Record<ViolationKind, string> = {
  only: "remove `.only` — a focused test silently skips every other test in the file",
  skip: "un-skip the test, or — only when intentionally grandfathering — run `bun scripts/check-test-integrity.ts --update`",
  "jest-mock": "this is a Bun project — use Bun's `mock`/`mock.module`, not jest.mock",
  "child-process-mock":
    'do not mock node:child_process — patch `Bun.spawnSync` / `Bun.spawn` directly (see CLAUDE.md)',
};

/**
 * True for test files under `apps/**` or `packages/**`: `*.test.ts(x)`,
 * `*.spec.ts(x)`, or any file inside a `__tests__/` directory. Backslashes are
 * normalized so Windows-style paths classify identically.
 */
export function isTestPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const top = normalized.split("/")[0];
  if (top !== "apps" && top !== "packages") return false;
  return (
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.split("/").includes("__tests__")
  );
}

/** Each kind's matcher. `g`-flagged so every occurrence is reported. */
const MATCHERS: { kind: ViolationKind; re: RegExp }[] = [
  { kind: "only", re: /\.only\s*\(/g },
  // Anchored to a test declarator so property reads like `snapshot.todo` or
  // `opts.skip` are not mistaken for skipped tests. `skip` is tried before
  // `skipIf`, but `\b` after `skip` fails on `skipIf`, so the engine backtracks
  // to the longer form. `xit` / `xdescribe` are the bare jasmine-style aliases.
  {
    kind: "skip",
    re: /\b(?:test|it|describe)\.(?:skip|skipIf|todo)\b|\bxit\b|\bxdescribe\b/g,
  },
  { kind: "jest-mock", re: /\bjest\.mock\s*\(/g },
  {
    kind: "child-process-mock",
    re: /\bmock\.module\s*\(\s*["']node:child_process["']/g,
  },
];

/** Return every test-integrity violation in `source`, with 1-based line. */
export function findViolations(source: string): Violation[] {
  const violations: Violation[] = [];
  for (const { kind, re } of MATCHERS) {
    for (const m of source.matchAll(re)) {
      const line = source.slice(0, m.index).split("\n").length;
      violations.push({ kind, match: m[0], line });
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

/** In-scope test files, normalized, sorted and de-duplicated. */
export async function collectTestFiles(root: string): Promise<string[]> {
  const set = new Set<string>();
  for (const pattern of SCAN_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root })) {
      const normalized = rel.replaceAll("\\", "/");
      if (isTestPath(normalized)) set.add(normalized);
    }
  }
  return [...set].sort();
}

export interface FileViolations {
  file: string;
  violations: Violation[];
}

/** Scan every in-scope test file and return those with violations. */
export async function scanTree(root: string): Promise<FileViolations[]> {
  const result: FileViolations[] = [];
  for (const rel of await collectTestFiles(root)) {
    const content = await Bun.file(join(root, rel)).text();
    const violations = findViolations(content);
    if (violations.length > 0) result.push({ file: rel, violations });
  }
  return result;
}

/** Per-file skip count derived from a scan result. */
export function skipCounts(scanned: FileViolations[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { file, violations } of scanned) {
    const n = violations.filter((v) => v.kind === "skip").length;
    if (n > 0) counts[file] = n;
  }
  return counts;
}

async function loadBaseline(): Promise<Record<string, number>> {
  const file = Bun.file(BASELINE_PATH);
  if (!(await file.exists())) return {};
  const parsed: unknown = JSON.parse(await file.text());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    out[key.replaceAll("\\", "/")] = Number(value);
  }
  return out;
}

async function writeBaseline(counts: Record<string, number>): Promise<void> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) sorted[key] = counts[key] ?? 0;
  await Bun.write(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const scanned = await scanTree(REPO_ROOT);
  const counts = skipCounts(scanned);

  if (update) {
    await writeBaseline(counts);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`✓ Wrote ${total} grandfathered skip(s) across ${Object.keys(counts).length} file(s) to ${BASELINE_PATH}`);
    for (const file of Object.keys(counts).sort()) console.log(`  ${file}: ${counts[file]}`);
    return;
  }

  // Zero-tolerance kinds: any occurrence is a hard failure.
  const banned: { file: string; v: Violation }[] = [];
  for (const { file, violations } of scanned) {
    for (const v of violations) {
      if (ZERO_TOLERANCE_KINDS.includes(v.kind)) banned.push({ file, v });
    }
  }

  // Ratcheted skips: compare per-file count to the baseline.
  const baseline = await loadBaseline();
  const newSkips: { file: string; cur: number; base: number }[] = [];
  for (const [file, cur] of Object.entries(counts)) {
    const base = baseline[file] ?? 0;
    if (cur > base) newSkips.push({ file, cur, base });
  }
  const staleEntries: { file: string; base: number; cur: number }[] = [];
  for (const [file, base] of Object.entries(baseline)) {
    const cur = counts[file] ?? 0;
    if (cur < base) staleEntries.push({ file, base, cur });
  }

  if (banned.length === 0 && newSkips.length === 0 && staleEntries.length === 0) {
    const total = Object.values(baseline).reduce((a, b) => a + b, 0);
    console.log(
      `✓ Test integrity clean (no .only / jest.mock / node:child_process mocks; ${total} grandfathered skip(s) in baseline)`,
    );
    return;
  }

  if (banned.length > 0) {
    console.error(`✘ Found ${banned.length} forbidden test pattern(s):\n`);
    for (const { file, v } of banned.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`  ${file}:${v.line}  ${v.match.trim()}  [${v.kind}]`);
      console.error(`    → ${FIX_MESSAGE[v.kind]}\n`);
    }
  }

  if (newSkips.length > 0) {
    console.error(`✘ ${newSkips.length} file(s) added skipped test(s) above the baseline:\n`);
    for (const { file, cur, base } of newSkips.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`  ${file}: ${base} → ${cur}`);
      console.error(`    → ${FIX_MESSAGE.skip}\n`);
    }
  }

  if (staleEntries.length > 0) {
    console.error(
      `✘ ${staleEntries.length} baseline entry/entries have fewer skips than recorded — refresh the baseline:\n`,
    );
    for (const { file, base, cur } of staleEntries.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`  ${file}: baseline ${base}, now ${cur}`);
    }
    console.error(`\n  → run \`bun scripts/check-test-integrity.ts --update\` to ratchet the baseline down\n`);
  }

  process.exit(1);
}

if (import.meta.main) {
  await main();
}
