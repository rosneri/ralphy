#!/usr/bin/env bun
/**
 * Filename Case Check
 *
 * All source files under apps/ and libs/ must use kebab-case filenames.
 * Exception: hook files (useSomething.ts) follow React camelCase convention.
 *
 * Valid:   auth.context.tsx, login-form.tsx, useGamePhase.ts, panel-body.tsx
 * Invalid: LoginForm.tsx, ThemeToggleWrapper.tsx, SignOutButton.tsx
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|mts)$/;

const EXEMPT_PATTERNS = [
  /node_modules/,
  /(?:^|\/)dist(?:\/|$)/,
  /(?:^|\/)\.next(?:\/|$)/,
  /(?:^|\/)\.vercel(?:\/|$)/,
  /generated/,
  /__fixtures__/,
  /\.playwright/,
];

function isExempt(filePath: string): boolean {
  return EXEMPT_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isHookFile(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

function isKebabCase(name: string): boolean {
  // Strip extension(s) — e.g. "login-form.test.tsx" → "login-form.test"
  const withoutFinalExt = name.replace(/\.[^.]+$/, "");
  // Allow: lowercase letters, digits, hyphens, dots (for .context, .test, etc.)
  return /^[a-z0-9][a-z0-9.-]*$/.test(withoutFinalExt);
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (isExempt(full)) continue;
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      yield full;
    }
  }
}

async function main(): Promise<void> {
  const scanRoots = [join(REPO_ROOT, "apps"), join(REPO_ROOT, "libs")];
  const violations: string[] = [];

  for (const root of scanRoots) {
    try {
      for await (const filePath of walkFiles(root)) {
        const name = filePath.split("/").pop() ?? "";
        if (isHookFile(name)) continue;
        if (!isKebabCase(name)) {
          violations.push(relative(REPO_ROOT, filePath));
        }
      }
    } catch {
      // directory may not exist
    }
  }

  if (violations.length === 0) {
    console.log("✓ All source files use kebab-case names (hooks exempt)");
    return;
  }

  console.error(`✘ Found ${violations.length} file(s) with non-kebab-case names:\n`);
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  console.error(
    "\nRename to kebab-case (e.g. LoginForm.tsx → login-form.tsx). Hook files (useSomething.ts) are exempt.",
  );
  process.exit(1);
}

await main();
