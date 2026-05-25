#!/usr/bin/env bun
/**
 * Test Location Check (ralphy variant)
 *
 * Test files must live inside a `__tests__/` directory, next to the package
 * or feature they cover. This keeps production source uncluttered and makes
 * the test surface easy to enumerate per workspace.
 *
 * Valid:   packages/output/src/__tests__/output.test.ts
 * Invalid: packages/output/src/output.test.ts
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

const SCAN_DIRS = [join(REPO_ROOT, "apps"), join(REPO_ROOT, "packages")];

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      if (entry.name === "dist") continue;
      yield* walk(full);
    } else if (/\.test\.(?:ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

function isUnderTestsDir(filePath: string): boolean {
  return filePath.split("/").includes("__tests__");
}

async function main(): Promise<void> {
  const violations: string[] = [];

  for (const dir of SCAN_DIRS) {
    try {
      for await (const file of walk(dir)) {
        if (!isUnderTestsDir(file)) {
          violations.push(relative(REPO_ROOT, file));
        }
      }
    } catch {
      // directory may not exist
    }
  }

  if (violations.length === 0) {
    console.log("✓ All test files live inside __tests__/ directories");
    return;
  }

  console.error(`✘ Found ${violations.length} test file(s) outside __tests__/ directories:\n`);
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  console.error(
    "\nMove each test into a __tests__/ subdirectory beside the code it covers (e.g. src/foo.ts → src/__tests__/foo.test.ts).",
  );
  process.exit(1);
}

await main();
