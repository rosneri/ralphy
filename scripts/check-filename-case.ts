#!/usr/bin/env bun
/**
 * Filename Case Check (ralphy variant)
 *
 * Source files under apps/ and packages/ must use one of:
 *   - kebab-case        (e.g. login-form.tsx, post-task.ts)
 *   - camelCase         (e.g. postTask.ts, useGamePhase.ts)
 *   - PascalCase        (e.g. App.tsx, AgentMode.tsx, TaskLoop.test.tsx)
 *
 * Hook files (useSomething.ts) follow React camelCase convention. Compound
 * extensions like `.test` / `.context` are allowed (foo.test.tsx, auth.context.tsx).
 *
 * Forbidden: SCREAMING_SNAKE_CASE, spaces, leading dot/digit, other punctuation.
 *
 * Valid:   App.tsx, postTask.ts, login-form.tsx, useGamePhase.ts, auth.context.tsx
 * Invalid: SCREAMING_CASE.ts, "with spaces.ts", 1foo.ts, _hidden.ts
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

function isValidName(name: string): boolean {
  // Strip final extension only — e.g. "login-form.test.tsx" → "login-form.test"
  const withoutFinalExt = name.replace(/\.[^.]+$/, "");
  // Each dot-separated segment must be kebab-case, camelCase, or PascalCase.
  // No SCREAMING_SNAKE (would need all-caps with underscores), no spaces, no
  // leading digit/symbol, no underscores.
  const segments = withoutFinalExt.split(".");
  if (segments.length === 0) return false;
  return segments.every((seg) => {
    if (seg.length === 0) return false;
    // Reject all-caps multi-letter segments (e.g. README, CONST_NAME).
    if (/^[A-Z]+$/.test(seg) && seg.length > 1) return false;
    // Allow: starts with letter, body is letters/digits/hyphens.
    return /^[A-Za-z][A-Za-z0-9-]*$/.test(seg);
  });
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
  const scanRoots = [join(REPO_ROOT, "apps"), join(REPO_ROOT, "packages")];
  const violations: string[] = [];

  for (const root of scanRoots) {
    try {
      for await (const filePath of walkFiles(root)) {
        const name = filePath.split("/").pop() ?? "";
        if (!isValidName(name)) {
          violations.push(relative(REPO_ROOT, filePath));
        }
      }
    } catch {
      // directory may not exist
    }
  }

  if (violations.length === 0) {
    console.log("✓ All source files use kebab-case, camelCase, or PascalCase names");
    return;
  }

  console.error(`✘ Found ${violations.length} file(s) with disallowed names:\n`);
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  console.error(
    "\nUse kebab-case, camelCase, or PascalCase. Forbidden: SCREAMING_SNAKE_CASE, spaces, leading digit/dot/underscore.",
  );
  process.exit(1);
}

await main();
