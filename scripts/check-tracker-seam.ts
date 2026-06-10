#!/usr/bin/env bun
/**
 * Tracker-seam leak guard (RLF-230).
 *
 * The orchestration core must depend only on the tracker-neutral
 * `@ralphy/tracker` shapes (`TrackedIssue` / `TrackedComment` / …), never on
 * the concrete Linear transport. This guard fails if any import binding whose
 * name starts with `Linear` appears in production source under the coordinator
 * runtime, the queue, or the three stop/flow XState machines.
 *
 * Test files are intentionally out of scope: they legitimately exercise the
 * concrete Linear adapter and the `LinearIssue = TrackedIssue` back-compat
 * alias, and three existing runtime test files import `LinearIssue`. Any path
 * ending in `.test.ts` or containing a `__tests__/` segment is skipped.
 *
 * Only *binding names* are inspected, never module paths — so a value import
 * with a non-`Linear*` name from the Linear module (e.g.
 * `import { issueMatchesGetIndicator } from "../agent/linear"`) is permitted.
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`. No node:fs.
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * Glob patterns (relative to the repo root) selecting the tracker-neutral core.
 * The `runtime/**` glob covers everything under `runtime/` (including
 * `runtime/machines/`); the two `packages/core` machines live outside it and
 * are listed explicitly.
 */
export const GUARDED_GLOBS = [
  "apps/agent/src/runtime/**/*.ts",
  "apps/agent/src/queue/**/*.ts",
  "packages/core/src/machines/flow.machine.ts",
  "packages/core/src/machines/loop.machine.ts",
];

/** Test files are exempt — see the module doc-comment. */
export function isExcludedTestPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.endsWith(".test.ts") || normalized.split("/").includes("__tests__");
}

/**
 * Return every `Linear*`-prefixed identifier imported by `source`, scanning the
 * binding clause of each `import … from "…"` statement. Module paths are never
 * inspected, so a non-`Linear*` binding from a Linear-named module is ignored.
 * Catches default, namespace, named, aliased (`Linear* as X` / `X as Linear*`),
 * and `import type` forms across multi-line statements.
 */
export function linearImportBindings(source: string): string[] {
  const found: string[] = [];
  // Capture the clause between `import [type]` and `from "<path>"`. `[\s\S]*?`
  // spans multi-line import lists; the path string is excluded from the clause.
  const importRe = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["'][^"']+["']/g;
  for (const match of source.matchAll(importRe)) {
    const clause = match[1] ?? "";
    for (const ident of clause.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []) {
      if (ident === "type" || ident === "as") continue;
      if (ident.startsWith("Linear")) found.push(ident);
    }
  }
  return found;
}

/** Files in scope after excluding test paths, sorted and de-duplicated. */
export async function collectGuardedFiles(root: string): Promise<string[]> {
  const set = new Set<string>();
  for (const pattern of GUARDED_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root })) {
      if (isExcludedTestPath(rel)) continue;
      set.add(rel.replaceAll("\\", "/"));
    }
  }
  return [...set].sort();
}

interface Violation {
  file: string;
  bindings: string[];
}

/** Scan the guarded tree and return every production file that leaks Linear*. */
export async function findViolations(root: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const rel of await collectGuardedFiles(root)) {
    const content = await Bun.file(join(root, rel)).text();
    const bindings = linearImportBindings(content);
    if (bindings.length > 0) {
      violations.push({ file: rel, bindings: [...new Set(bindings)] });
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const violations = await findViolations(REPO_ROOT);

  if (violations.length === 0) {
    console.log(
      "✓ No Linear* import bindings in the tracker-neutral core (runtime/queue/machines)",
    );
    return;
  }

  console.error(`✘ Found Linear* import bindings in ${violations.length} core source file(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file} → ${v.bindings.join(", ")}`);
  }
  console.error(
    "\nThe orchestration core (runtime/queue/machines) must import tracker-neutral\n" +
      "shapes from @ralphy/tracker (e.g. TrackedIssue), not Linear* types. Test\n" +
      "files are exempt. See scripts/check-tracker-seam.ts.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
