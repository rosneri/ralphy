#!/usr/bin/env bun
/**
 * Bun-native API ratchet guard (RLF-259).
 *
 * CLAUDE.md mandates Bun-native APIs and forbids `node:fs` **sync** APIs in
 * source. This guard enforces that rule for *new* code while grandfathering the
 * existing debt via a JSON baseline, so the gate becomes enforceable today
 * without a big-bang migration.
 *
 * Three banned import shapes are flagged in source under `packages/<n>/src`,
 * `apps/<n>/src`, and `apps/ui/src-sidecar` (test files excluded):
 *
 *   - any named import ending in `Sync` from `node:fs`
 *     (`readFileSync`, `writeFileSync`, `existsSync`, …)
 *   - `createHash` from `node:crypto`
 *   - the deprecated `exists` from `node:fs/promises`
 *
 * Non-banned imports are explicitly allowed: `createWriteStream` from `node:fs`
 * (not a `*Sync` API) and async `node:fs/promises` functions other than
 * `exists` (`mkdir`, `rm`, `readFile`, …).
 *
 * A violating file listed in `scripts/.bun-native-baseline.json` is allowed; a
 * violating file *not* in the baseline is a hard failure (exit 1). A baseline
 * entry that no longer violates is reported as stale (also exit 1) so the debt
 * burns down rather than lingering. Run with `--update` to regenerate the
 * baseline from the live tree.
 *
 * Only *named-import lists* are inspected — default and namespace
 * (`import * as fs`) imports are out of scope for v1 (a known gap; the matcher
 * can be extended if it later matters).
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`. No node:fs.
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", ".bun-native-baseline.json");

/** Source roots scanned for violations (relative to the repo root). */
export const SCAN_GLOBS = [
  "packages/*/src/**/*.{ts,tsx}",
  "apps/*/src/**/*.{ts,tsx}",
  "apps/ui/src-sidecar/**/*.{ts,tsx}",
];

export type BannedKind = "fs-sync" | "crypto-createHash" | "fs-promises-exists";

export interface Violation {
  kind: BannedKind;
  binding: string;
  line: number;
}

/** The three guarded modules and the Bun-native fix for each banned shape. */
const FIX_MESSAGE: Record<BannedKind, string> = {
  "fs-sync":
    "use Bun.file(p).text() / Bun.write(p, data) / await Bun.file(p).exists() (or async node:fs/promises) instead of a node:fs *Sync API",
  "crypto-createHash": "use new Bun.CryptoHasher(algo) instead of node:crypto createHash",
  "fs-promises-exists":
    "use await Bun.file(p).exists() instead of the deprecated node:fs/promises exists",
};

/** Test files are exempt — they legitimately exercise sync / `exists`. */
export function isExcludedTestPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.split("/").includes("__tests__")
  );
}

/** Classify a binding imported from `module` as a banned shape, or null. */
export function classifyBinding(module: string, binding: string): BannedKind | null {
  if (module === "node:fs" && binding.endsWith("Sync")) return "fs-sync";
  if (module === "node:crypto" && binding === "createHash") return "crypto-createHash";
  if (module === "node:fs/promises" && binding === "exists") return "fs-promises-exists";
  return null;
}

/**
 * Return every banned import in `source`. Scans the named-binding list of each
 * `import [type] { … } from "node:fs|node:crypto|node:fs/promises"` statement,
 * across single- and multi-line forms. The *original* binding name is inspected
 * (the left side of `as`), with inline `type` modifiers stripped, so
 * `import { readFileSync as rfs }` and `import { type existsSync }` are both
 * caught. Default / namespace imports (no `{ … }`) are not inspected.
 */
export function findViolations(source: string): Violation[] {
  const violations: Violation[] = [];
  // Capture the brace clause and module path. `[\s\S]*?` spans multi-line lists.
  const importRe =
    /import\s+(?:type\s+)?(\{[\s\S]*?\})\s+from\s+["'](node:fs|node:crypto|node:fs\/promises)["']/g;
  // A single named entry: optional inline `type`, the original binding, an
  // optional `as <alias>`. Group 1 is the binding we inspect.
  const entryRe = /(?:\btype\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$][\w$]*)?/g;

  for (const match of source.matchAll(importRe)) {
    const clause = match[1] ?? "";
    const module = match[2] ?? "";
    const clauseStart = source.indexOf(clause, match.index);
    // Strip the surrounding braces so `{`/`}` aren't read as identifiers.
    const inner = clause.slice(1, -1);
    const innerStart = clauseStart + 1;

    for (const entry of inner.matchAll(entryRe)) {
      const binding = entry[1] ?? "";
      const kind = classifyBinding(module, binding);
      if (!kind) continue;
      const bindingOffset = innerStart + (entry.index ?? 0) + entry[0].indexOf(binding);
      const line = source.slice(0, bindingOffset).split("\n").length;
      violations.push({ kind, binding, line });
    }
  }
  return violations;
}

/** Files in scope after excluding test paths, sorted and de-duplicated. */
export async function collectSourceFiles(root: string): Promise<string[]> {
  const set = new Set<string>();
  for (const pattern of SCAN_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root })) {
      const normalized = rel.replaceAll("\\", "/");
      if (isExcludedTestPath(normalized)) continue;
      set.add(normalized);
    }
  }
  return [...set].sort();
}

export interface FileViolations {
  file: string;
  violations: Violation[];
}

/** Scan every in-scope source file and return those with banned imports. */
export async function scanTree(root: string): Promise<FileViolations[]> {
  const result: FileViolations[] = [];
  for (const rel of await collectSourceFiles(root)) {
    const content = await Bun.file(join(root, rel)).text();
    const violations = findViolations(content);
    if (violations.length > 0) result.push({ file: rel, violations });
  }
  return result;
}

async function loadBaseline(): Promise<string[]> {
  const file = Bun.file(BASELINE_PATH);
  if (!(await file.exists())) return [];
  const parsed: unknown = JSON.parse(await file.text());
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => String(entry).replaceAll("\\", "/"));
}

async function writeBaseline(files: string[]): Promise<void> {
  await Bun.write(BASELINE_PATH, `${JSON.stringify(files, null, 2)}\n`);
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const violating = await scanTree(REPO_ROOT);
  const violatingFiles = violating.map((v) => v.file).sort();

  if (update) {
    await writeBaseline(violatingFiles);
    console.log(`✓ Wrote ${violatingFiles.length} grandfathered file(s) to ${BASELINE_PATH}`);
    for (const file of violatingFiles) console.log(`  ${file}`);
    return;
  }

  const baseline = await loadBaseline();
  const baselineSet = new Set(baseline);
  const violatingSet = new Set(violatingFiles);

  const newViolations = violating.filter((v) => !baselineSet.has(v.file));
  const staleEntries = baseline.filter((entry) => !violatingSet.has(entry)).sort();

  if (newViolations.length === 0 && staleEntries.length === 0) {
    console.log(
      `✓ No new banned node-native imports (${baseline.length} grandfathered file(s) in baseline)`,
    );
    return;
  }

  if (newViolations.length > 0) {
    console.error(
      `✘ Found banned node-native imports in ${newViolations.length} non-baselined source file(s):\n`,
    );
    for (const { file, violations } of newViolations) {
      for (const v of violations) {
        console.error(`  ${file}:${v.line}  ${v.binding}`);
        console.error(`    → ${FIX_MESSAGE[v.kind]}\n`);
      }
    }
  }

  if (staleEntries.length > 0) {
    console.error(
      `✘ ${staleEntries.length} baseline entry/entries no longer violate — remove them from ${BASELINE_PATH}:\n`,
    );
    for (const entry of staleEntries) console.error(`  ${entry}`);
    console.error("");
  }

  console.error(
    "Bun-native APIs are required (see CLAUDE.md). Fix the import, or — only when\n" +
      "intentionally grandfathering existing debt — run `bun scripts/check-bun-native.ts --update`.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
