#!/usr/bin/env bun
/**
 * Per-file LOC budget guardrail (RLF-258).
 *
 * Caps the number of lines in any production source file. A flat hard cap is
 * either impossibly strict (god-files already exist) or uselessly high, so
 * today's offenders are grandfathered into a committed baseline
 * (`scripts/.file-size-baseline.json`) and this guard only blocks:
 *
 *   1. a *new* file over budget, or
 *   2. a *baselined* file that *grew* past its recorded count.
 *
 * Shrinking a file is always allowed and, via `--update`, ratchets the baseline
 * down to lock in the gain.
 *
 * Mirrors `check-tracker-seam.ts`: pure helpers are exported so tests import
 * them directly, and `main()` runs only when executed as a script (guarded by
 * `if (import.meta.main)`), so importing the module has no side effects.
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`, writes with
 * `Bun.write`. No node:fs.
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

/** Maximum allowed lines in a single production source file. */
export const MAX_LINES = 400;

/** Path of the committed grandfather baseline, repo-relative. */
export const BASELINE_PATH = "scripts/.file-size-baseline.json";

/**
 * Glob patterns (relative to the repo root) selecting production source. Tests,
 * generated code, fixtures, and build output are excluded via {@link isExcluded}.
 */
export const SOURCE_GLOBS = ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"];

const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;

const EXEMPT_SEGMENTS = ["__tests__", "dist", "generated", "__fixtures__"];

/** True for paths that are out of scope: tests, generated code, fixtures, build output. */
export function isExcluded(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (TEST_FILE.test(normalized)) return true;
  const segments = normalized.split("/");
  return segments.some((seg) => EXEMPT_SEGMENTS.includes(seg));
}

/**
 * Count lines in `text`. A trailing newline does not add a phantom empty line,
 * so a file of N lines terminated by "\n" counts as N. Used for both checking
 * and `--update` generation so a freshly generated baseline always passes.
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split("\n").length;
}

/** Production source files in scope, repo-relative POSIX paths, sorted. */
export async function collectSourceFiles(repoRoot: string): Promise<string[]> {
  const set = new Set<string>();
  for (const pattern of SOURCE_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: repoRoot })) {
      const normalized = rel.replaceAll("\\", "/");
      if (isExcluded(normalized)) continue;
      set.add(normalized);
    }
  }
  return [...set].sort();
}

/** Map of repo-relative path → line count for every in-scope source file. */
export async function collectSizes(repoRoot: string): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const rel of await collectSourceFiles(repoRoot)) {
    const text = await Bun.file(join(repoRoot, rel)).text();
    sizes[rel] = countLines(text);
  }
  return sizes;
}

/** Read + parse the baseline JSON; return `{}` if the file is missing. */
export async function loadBaseline(path: string): Promise<Record<string, number>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  return (await file.json()) as Record<string, number>;
}

export interface Violation {
  file: string;
  lines: number;
  /** Recorded baseline count, or `null` if the file is not baselined. */
  baseline: number | null;
}

/**
 * Pure core: for each file over `maxLines`, flag it unless its current count is
 * within the recorded baseline. A baselined file that grew past its recorded
 * count is a violation; one that shrank (even if still over budget) is not.
 */
export function findViolations(
  sizes: Record<string, number>,
  baseline: Record<string, number>,
  maxLines: number,
): Violation[] {
  const violations: Violation[] = [];
  for (const [file, lines] of Object.entries(sizes)) {
    if (lines <= maxLines) continue;
    const recorded = baseline[file];
    if (recorded === undefined) {
      violations.push({ file, lines, baseline: null });
    } else if (lines > recorded) {
      violations.push({ file, lines, baseline: recorded });
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * `--update` mode: recompute the baseline. Include every file currently over
 * budget; for files already baselined use `min(current, existing)` so entries
 * only ratchet *down*; drop entries for files that fell to/below budget.
 */
export function computeUpdatedBaseline(
  sizes: Record<string, number>,
  existing: Record<string, number>,
  maxLines: number,
): Record<string, number> {
  const updated: Record<string, number> = {};
  for (const [file, lines] of Object.entries(sizes)) {
    if (lines <= maxLines) continue;
    const recorded = existing[file];
    updated[file] = recorded === undefined ? lines : Math.min(lines, recorded);
  }
  return updated;
}

/** Serialize a baseline with sorted keys and a trailing newline for stable diffs. */
export function serializeBaseline(baseline: Record<string, number>): string {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(baseline).sort()) {
    sorted[key] = baseline[key]!;
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const sizes = await collectSizes(REPO_ROOT);
  const baselinePath = join(REPO_ROOT, BASELINE_PATH);

  if (update) {
    const existing = await loadBaseline(baselinePath);
    const updated = computeUpdatedBaseline(sizes, existing, MAX_LINES);
    await Bun.write(baselinePath, serializeBaseline(updated));
    const count = Object.keys(updated).length;
    console.log(`✓ Wrote ${BASELINE_PATH} with ${count} grandfathered file(s)`);
    return;
  }

  const baseline = await loadBaseline(baselinePath);
  const violations = findViolations(sizes, baseline, MAX_LINES);

  if (violations.length === 0) {
    console.log(`✓ No source file exceeds ${MAX_LINES} lines (beyond the grandfathered baseline)`);
    return;
  }

  console.error(`✘ Found ${violations.length} file(s) over the ${MAX_LINES}-line budget:\n`);
  for (const v of violations) {
    const detail =
      v.baseline === null
        ? `${v.lines} lines (new file over budget)`
        : `${v.lines} lines (grew past baseline of ${v.baseline})`;
    console.error(`  ${v.file} → ${detail}`);
  }
  console.error(
    `\nKeep production source files at or under ${MAX_LINES} lines. Split large files\n` +
      "into focused modules. If a file legitimately shrank but is still over budget,\n" +
      `run \`bun scripts/check-file-size.ts --update\` to ratchet the baseline down.\n` +
      "Never hand-raise a baseline entry. See scripts/check-file-size.ts.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
