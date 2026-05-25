#!/usr/bin/env bun
/**
 * Test Location Check
 *
 * Test files must live next to the source file they test, NOT inside __tests__/ directories.
 * This keeps tests discoverable and co-located with the code they cover.
 *
 * Exception: Astro API route tests (apps/game-astro/src/pages/api/**) are allowed in
 * __tests__/ subdirectories because Astro excludes _-prefixed dirs from routing.
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

const SCAN_DIRS = [join(REPO_ROOT, "libs"), join(REPO_ROOT, "apps")];

const ALLOWED_TESTS_DIR = join(REPO_ROOT, "apps", "game-astro", "src", "pages", "api");

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (/\.test\.(?:ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

function isUnderTestsDir(filePath: string): boolean {
  return filePath.split("/").includes("__tests__");
}

function isAllowedTestsDir(filePath: string): boolean {
  return filePath.startsWith(ALLOWED_TESTS_DIR + "/");
}

async function main(): Promise<void> {
  const violations: string[] = [];

  for (const dir of SCAN_DIRS) {
    try {
      for await (const file of walk(dir)) {
        if (isUnderTestsDir(file) && !isAllowedTestsDir(file)) {
          violations.push(relative(REPO_ROOT, file));
        }
      }
    } catch {
      // directory may not exist
    }
  }

  if (violations.length === 0) {
    console.log("✓ All test files are co-located next to their source files");
    return;
  }

  console.error(`✘ Found ${violations.length} test file(s) inside __tests__/ directories:\n`);
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  console.error(
    "\nTest files must live next to the source file they test (e.g. foo.test.ts beside foo.ts).",
  );
  console.error(
    "Only Astro API route tests (apps/game-astro/src/pages/api/**/__tests__/) may use __tests__/.",
  );
  process.exit(1);
}

await main();
