#!/usr/bin/env bun
/**
 * Per-file line-count cap (RLF-258).
 *
 * Enforces a single hard cap on every production source file. There is no
 * baseline, no grandfathering, and no override: any in-scope file over
 * {@link MAX_LINES} lines fails the check. Split oversized files into
 * focused modules instead of raising a limit.
 *
 * Mirrors `check-tracker-seam.ts`: pure helpers are exported so tests import
 * them directly, and `main()` only runs when executed as a script (guarded by
 * `import.meta.main`), so importing this module has no side effects.
 *
 * Bun-native: enumerates with `Bun.Glob` and reads with `Bun.file`. No node:fs.
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

/** Maximum allowed lines in a single production source file. */
export const MAX_LINES = 400;

/**
 * Glob patterns (relative to repo root) selecting production source. Tests,
 * generated code, fixtures, and build output are excluded via {@link isExcluded}.
 */
export const SOURCE_GLOBS = ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"];

const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;

const EXEMPT_SEGMENTS = ["__tests__", "dist", "generated", "node_modules"];

/** True when a repo-relative path should be excluded from the budget. */
export function isExcluded(relativePath: string): boolean {
  if (TEST_FILE.test(relativePath)) return true;
  const segments = relativePath.split("/");
  return segments.some((segment) => EXEMPT_SEGMENTS.includes(segment));
}

/**
 * Count lines the way an editor does: the number of newline-separated rows,
 * ignoring a single trailing newline. Empty text counts as zero lines.
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split("\n").length;
}

/** Production source files in scope, as repo-relative POSIX paths, sorted. */
export async function collectSourceFiles(repoRoot: string): Promise<string[]> {
  const set = new Set<string>();
  for (const pattern of SOURCE_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const relativePath of glob.scan({ cwd: repoRoot })) {
      const normalized = relativePath.replaceAll("\\", "/");
      if (isExcluded(normalized)) continue;
      set.add(normalized);
    }
  }
  return [...set].sort();
}

/** Map repo-relative path to line count for every in-scope source file. */
export async function collectSizes(repoRoot: string): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const relativePath of await collectSourceFiles(repoRoot)) {
    const text = await Bun.file(join(repoRoot, relativePath)).text();
    sizes[relativePath] = countLines(text);
  }
  return sizes;
}

export interface Violation {
  file: string;
  lines: number;
}

/** Pure core: every file whose line count exceeds `maxLines`, sorted by path. */
export function findViolations(sizes: Record<string, number>, maxLines: number): Violation[] {
  const violations: Violation[] = [];
  for (const [file, lines] of Object.entries(sizes)) {
    if (lines > maxLines) {
      violations.push({ file, lines });
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file));
}

async function main(): Promise<void> {
  const sizes = await collectSizes(REPO_ROOT);
  const violations = findViolations(sizes, MAX_LINES);

  if (violations.length === 0) {
    const count = Object.keys(sizes).length;
    console.log(`✓ All ${count} source files are within ${MAX_LINES} lines.`);
    return;
  }

  console.error(`✗ ${violations.length} file(s) exceed the ${MAX_LINES}-line cap:\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file} — ${violation.lines} lines`);
  }
  console.error(
    `\nKeep production source files within ${MAX_LINES} lines. Split large files\n` +
      "into focused modules. The cap is hard: there is no baseline or override.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
