#!/usr/bin/env bun
/**
 * Config-Merge Seam Check (RLF-256)
 *
 * There is exactly ONE place config precedence is resolved: `mergeConfig` in
 * `@ralphy/config` (argv ⊕ WORKFLOW.md ⊕ schema defaults, `cli > workflow >
 * default`). App code must read the already-merged `effective` value and never
 * re-implement that precedence inline. The two classic re-implementations are:
 *
 *   - `args.x || cfg.y`        — loses an explicit falsy override (0, "", false)
 *   - `args.x !== <default>`   — the sentinel-compare bug presence-merge killed
 *
 * This guard walks every `apps/<app>/src` `.ts`/`.tsx` file (skipping `__tests__`,
 * `dist`, `node_modules`) and fails on either pattern. Genuine, reviewed
 * exceptions go in ALLOWLIST as `file:line` strings (ratcheting — keep it small).
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const APPS_DIR = join(REPO_ROOT, "apps");

/** `args.foo || cfg.bar` / `... || config.bar` — argv-or-config fallback. */
export const OR_CONFIG_FALLBACK = /\|\|\s*(?:cfg|config)\./;
/** `args.foo !== <something>` — a sentinel comparison standing in for a merge. */
export const ARGS_SENTINEL_COMPARE = /\bargs\.\w+\s*!==\s/;

/** Reviewed, sanctioned exceptions, anchored as `relative/path.ts:line`. */
export const ALLOWLIST = new Set<string>([]);

const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git", "__tests__"]);

export interface Violation {
  file: string;
  line: number;
  text: string;
  rule: string;
}

/** Pure line scanner — the matcher, exported so tests can plant fixtures. */
export function scanSource(source: string, relPath: string): Violation[] {
  const lines = source.split("\n");
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    // Skip comment lines so prose describing the anti-pattern is not flagged.
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const anchor = `${relPath}:${i + 1}`;
    if (ALLOWLIST.has(anchor)) continue;
    if (OR_CONFIG_FALLBACK.test(line)) {
      violations.push({ file: relPath, line: i + 1, text: trimmed, rule: "args.x || cfg.y" });
    } else if (ARGS_SENTINEL_COMPARE.test(line)) {
      violations.push({ file: relPath, line: i + 1, text: trimmed, rule: "args.x !== <default>" });
    }
  }
  return violations;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Scan every guarded file under `apps/`, returning all violations. */
export async function findViolations(appsDir: string = APPS_DIR): Promise<Violation[]> {
  const violations: Violation[] = [];
  for await (const file of walk(appsDir)) {
    const source = await readFile(file, "utf8");
    violations.push(...scanSource(source, relative(REPO_ROOT, file)));
  }
  return violations;
}

async function main(): Promise<void> {
  const violations = await findViolations();

  if (violations.length === 0) {
    console.log("✓ No inline config-merge seams (args.x || cfg.y / sentinel compares) in apps");
    return;
  }

  console.error(`✘ Found ${violations.length} inline config-merge seam(s):\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  [${violation.rule}]`);
    console.error(`    ${violation.text}\n`);
  }
  console.error(
    "Resolve config once via mergeConfig/resolveParsedConfig and read `effective` instead.",
  );
  console.error(
    "If this is a genuine, reviewed exception, add `file:line` to ALLOWLIST in this script.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
