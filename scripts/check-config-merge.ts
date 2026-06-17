#!/usr/bin/env bun
/**
 * Imperative config-merge ratchet guard (RLF-265).
 *
 * CLAUDE.md mandates one config pipeline (`packages/config`, `resolveConfig`):
 * argv ⊕ WORKFLOW.md ⊕ schema defaults are merged in exactly one place with
 * `cli > workflow > default` precedence. App code is supposed to call
 * `resolveConfig`/`resolveParsedConfig` at boot and read `effective` — never
 * re-implement precedence inline with `args.x || cfg.y`.
 *
 * This guard bans the imperative merge shape for *new* code while grandfathering
 * the existing debt via a JSON baseline, so the gate becomes enforceable today
 * without a big-bang migration and the burndown work (#421) can only shrink the
 * count, never grow it.
 *
 * The banned pattern is an OR/nullish fallback whose RIGHT operand is a member
 * access rooted at a known config identifier:
 *
 *   args.x || cfg.y          x ?? config.y          a || cfg?.linear.team
 *
 * `??` is banned alongside `||`: switching `||`→`??` "fixes" the falsy-value bug
 * (`0` / `""` / `false`) but is still a banned imperative merge.
 *
 * `CONFIG_ROOTS` (`cfg`, `config`) is the recognised set of config identifiers.
 *
 * Deliberate v1 scope limits (documented gaps, like check-bun-native's
 * namespace-import gap):
 *   - RHS only. Only config-on-the-right (`x || cfg.y`) is flagged — the shape
 *     of every verified site. `cfg.x || fallback` (config on the left) is a
 *     legitimate read-with-default and is out of scope.
 *   - The `args.x !== <default>` precedence form is NOT flagged: zero live
 *     sites and a bare `!==`-vs-literal matcher is high-false-positive. Left as
 *     a future extension.
 *   - No inline escape hatch. `|| cfg.x` outside the config package is
 *     essentially never legitimate; the baseline (`--update`) is the only
 *     sanctioned grandfathering path.
 *
 * A violating file is allowed up to its baselined COUNT; any in-scope file whose
 * count *exceeds* its baseline is a hard failure (exit 1). A baseline file whose
 * count *drops* below its baseline is reported as stale (also exit 1) so the
 * debt burns down monotonically rather than lingering. Run with `--update` to
 * regenerate the baseline from the live tree.
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`, writes with
 * `Bun.write`. No node:fs sync APIs (else this guard would trip check-bun-native).
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", ".config-merge-baseline.json");

/** Source roots scanned for violations (relative to the repo root). */
export const SCAN_GLOBS = [
  "apps/*/src/**/*.{ts,tsx}",
  "packages/*/src/**/*.{ts,tsx}",
];

/** Recognised config-identifier roots on the right of the fallback. */
export const CONFIG_ROOTS = ["cfg", "config"] as const;

export interface Violation {
  root: string;
  line: number;
}

/**
 * Blank the *contents* of line comments (`//…`), block comments (`/*…*\/`), and
 * single/double-quoted strings + template literals with spaces, preserving
 * newlines and total length so byte offsets and line numbers stay exact. This
 * removes the only realistic false-positive sources (a docstring mention of the
 * banned pattern, or a `"a || cfg.b"` string literal).
 */
export function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  const keep = (ch: string) => out.push(ch);
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");

  while (i < n) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    // Line comment
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") blank(source[i++] ?? "");
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      blank(ch);
      blank(next);
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) blank(source[i++] ?? "");
      if (i < n) {
        blank(source[i] ?? ""); // *
        blank(source[i + 1] ?? ""); // /
        i += 2;
      }
      continue;
    }
    // String / template literal
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      keep(ch); // keep the opening delimiter; blank the contents
      i += 1;
      while (i < n) {
        const c = source[i] ?? "";
        if (c === "\\") {
          // escape: blank both the backslash and the escaped char
          blank(c);
          if (i + 1 < n) blank(source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === quote) {
          keep(c); // keep the closing delimiter
          i += 1;
          break;
        }
        blank(c);
        i += 1;
      }
      continue;
    }
    keep(ch);
    i += 1;
  }
  return out.join("");
}

/**
 * Return every imperative config-merge in `source`. Comments and string
 * contents are stripped first, then the fallback regex matches an OR/nullish
 * (`||` or `??`) whose right operand is a member access rooted at a
 * `CONFIG_ROOTS` identifier, tolerating optional chaining (`cfg?.linear.team`).
 */
export function findViolations(source: string): Violation[] {
  const stripped = stripCommentsAndStrings(source);
  const re = /(?:\|\||\?\?)\s*(cfg|config)\b\s*(?:\?\.|\.)/g;
  const violations: Violation[] = [];
  for (const match of stripped.matchAll(re)) {
    const root = match[1] ?? "";
    const line = stripped.slice(0, match.index).split("\n").length;
    violations.push({ root, line });
  }
  return violations;
}

/**
 * Excluded from scanning: the sanctioned merge home (`packages/config/`,
 * `packages/cli-args/`) and test files (`*.test.*` / `*.spec.*` / `__tests__/`).
 */
export function isExcludedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("packages/config/")) return true;
  if (normalized.startsWith("packages/cli-args/")) return true;
  const segments = normalized.split("/");
  if (segments.includes("__tests__")) return true;
  return (
    /\.test\.(ts|tsx)$/.test(normalized) || /\.spec\.(ts|tsx)$/.test(normalized)
  );
}

/** Files in scope after exclusions, sorted and de-duplicated. */
export async function collectSourceFiles(root: string): Promise<string[]> {
  const set = new Set<string>();
  for (const pattern of SCAN_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root })) {
      const normalized = rel.replaceAll("\\", "/");
      if (isExcludedPath(normalized)) continue;
      set.add(normalized);
    }
  }
  return [...set].sort();
}

/** Scan every in-scope file and return a `relpath → violation count` map. */
export async function scanTree(root: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const rel of await collectSourceFiles(root)) {
    const content = await Bun.file(join(root, rel)).text();
    const count = findViolations(content).length;
    if (count > 0) result.set(rel, count);
  }
  return result;
}

export type Baseline = Record<string, number>;

export interface BaselineDiff {
  /** Files whose live count exceeds their baseline (or are absent from it). */
  newViolations: { file: string; actual: number; allowed: number }[];
  /** Baseline files whose live count dropped below the baselined count. */
  staleEntries: { file: string; actual: number; baseline: number }[];
}

/** Pure ratchet diff. Counts must be monotonically non-increasing per file. */
export function diffBaseline(actual: Map<string, number>, baseline: Baseline): BaselineDiff {
  const newViolations: BaselineDiff["newViolations"] = [];
  for (const [file, count] of actual) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) newViolations.push({ file, actual: count, allowed });
  }
  const staleEntries: BaselineDiff["staleEntries"] = [];
  for (const [file, baselined] of Object.entries(baseline)) {
    const count = actual.get(file) ?? 0;
    if (count < baselined) staleEntries.push({ file, actual: count, baseline: baselined });
  }
  newViolations.sort((a, b) => a.file.localeCompare(b.file));
  staleEntries.sort((a, b) => a.file.localeCompare(b.file));
  return { newViolations, staleEntries };
}

async function loadBaseline(): Promise<Baseline> {
  const file = Bun.file(BASELINE_PATH);
  if (!(await file.exists())) return {};
  const parsed: unknown = JSON.parse(await file.text());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Baseline = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "number") out[k.replaceAll("\\", "/")] = v;
  }
  return out;
}

async function writeBaseline(actual: Map<string, number>): Promise<void> {
  const sorted: Baseline = {};
  for (const file of [...actual.keys()].sort()) sorted[file] = actual.get(file) ?? 0;
  await Bun.write(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

function totalCount(actual: Map<string, number>): number {
  let total = 0;
  for (const count of actual.values()) total += count;
  return total;
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const actual = await scanTree(REPO_ROOT);

  if (update) {
    await writeBaseline(actual);
    console.log(
      `✓ Wrote baseline (${totalCount(actual)} occurrence(s) across ${actual.size} file(s)) to ${BASELINE_PATH}`,
    );
    for (const file of [...actual.keys()].sort()) console.log(`  ${file}: ${actual.get(file)}`);
    return;
  }

  const baseline = await loadBaseline();
  const { newViolations, staleEntries } = diffBaseline(actual, baseline);

  if (newViolations.length === 0 && staleEntries.length === 0) {
    const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
    console.log(
      `✓ No new imperative config merges (${baseTotal} occurrence(s) across ${Object.keys(baseline).length} file(s) grandfathered)`,
    );
    return;
  }

  if (newViolations.length > 0) {
    console.error(
      `✘ Found new imperative config merges (args.x || cfg.y) in ${newViolations.length} file(s):\n`,
    );
    for (const { file, actual: count, allowed } of newViolations) {
      const content = await Bun.file(join(REPO_ROOT, file)).text();
      console.error(`  ${file}  (${count} > ${allowed} allowed):`);
      for (const v of findViolations(content)) console.error(`    ${file}:${v.line}  || ${v.root}.…`);
      console.error("");
    }
  }

  if (staleEntries.length > 0) {
    console.error(
      `✘ ${staleEntries.length} baseline entry/entries dropped below their count — run \`--update\` to tighten:\n`,
    );
    for (const { file, actual: count, baseline: was } of staleEntries) {
      console.error(`  ${file}: ${count} < ${was}`);
    }
    console.error("");
  }

  console.error(
    "One config pipeline (packages/config). Call resolveConfig at boot and read\n" +
      "`effective` — do not merge precedence inline (see CLAUDE.md). Only when\n" +
      "intentionally grandfathering existing debt, run `bun scripts/check-config-merge.ts --update`.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
