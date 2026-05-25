#!/usr/bin/env bun
/**
 * No Re-export-Only TSX/TS Files Check
 *
 * Enforces that no `.tsx` or `.ts` file consists solely of re-exports. A file
 * is a violation if every non-blank, non-comment line is an `export ... from`
 * or `export type ... from` statement. Such files add indirection without value
 * and should either contain actual definitions or be removed.
 *
 * Exemptions:
 *  - `index.ts` files (intended public barrels)
 *  - `.test.ts` / `.test.tsx` files
 *
 * Scans: libs/game-ui/src + apps/game-astro/src
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

function getScanDirs(): string[] {
  return [join(REPO_ROOT, "libs", "game-ui", "src"), join(REPO_ROOT, "apps", "game-astro", "src")];
}

const BLANK_OR_COMMENT = /^\s*(\/\/.*|\/\*.*\*\/\s*|\/\*.*|\*.*|\*\/\s*)?$/;
const REEXPORT_LINE =
  /^\s*export\s+(type\s+)?\{[^}]*\}\s+from\s+['"]|^\s*export\s+(type\s+)?\*\s+(as\s+\w+\s+)?from\s+['"]/;

function shouldScan(name: string, parentDir: string): boolean {
  if (name === "index.ts") return false;
  if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return false;
  if (parentDir.includes("generated")) return false;
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (shouldScan(entry.name, dir)) {
      yield full;
    }
  }
}

function isReexportOnly(source: string): boolean {
  const lines = source.split("\n");
  const significantLines = lines.filter((line) => !BLANK_OR_COMMENT.test(line));
  if (significantLines.length === 0) return false;
  return significantLines.every((line) => REEXPORT_LINE.test(line));
}

async function scanFile(filePath: string): Promise<string | null> {
  const source = await readFile(filePath, "utf8");
  if (isReexportOnly(source)) return relative(REPO_ROOT, filePath);
  return null;
}

async function main(): Promise<void> {
  const violations: string[] = [];
  const SCAN_DIRS = getScanDirs();

  for (const dir of SCAN_DIRS) {
    try {
      for await (const file of walk(dir)) {
        const result = await scanFile(file);
        if (result) violations.push(result);
      }
    } catch {
      // directory may not exist
    }
  }

  if (violations.length === 0) {
    console.log("✓ No re-export-only .tsx files found.");
    return;
  }

  console.error(`✘ Found ${violations.length} file(s) consisting solely of re-exports:\n`);
  for (const file of violations) {
    console.error(`  ${file}`);
  }
  console.error(
    [
      "",
      "Files that only re-export from other modules add indirection without value.",
      "Add actual definitions, inline the re-exports into the importing files,",
      "or use index.ts as the single intentional barrel.",
    ].join("\n"),
  );
  process.exit(1);
}

await main();
