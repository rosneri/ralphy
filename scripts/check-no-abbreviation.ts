#!/usr/bin/env bun
/**
 * No-abbreviation identifier ratchet guard (RLF-266).
 *
 * CLAUDE.md mandates that names be spelled out — "do not abbreviate
 * identifiers". This guard enforces that rule for *new* code while
 * grandfathering the existing debt via a JSON baseline, so the gate becomes
 * enforceable today without a big-bang rename. It deliberately mirrors the
 * shape of `scripts/check-bun-native.ts` (RLF-259) so the codebase has one
 * consistent ratchet shape.
 *
 * Only **author-chosen declaration/binding names** are inspected — the place a
 * name is *introduced*, not every reference. Concretely, the AST walk collects:
 *
 *   - `VariableDeclarator` ids (incl. names bound in array/object destructuring),
 *   - `FunctionDeclaration` / `ClassDeclaration` / `TSInterfaceDeclaration` /
 *     `TSTypeAliasDeclaration` / `TSEnumDeclaration` names,
 *   - function/method parameter names (incl. destructured binding names).
 *
 * Explicitly NOT inspected (v1 scope): member-access references (`foo.cfg`),
 * object-literal property keys (`{ cfg: 1 }`), import binding names, and string
 * literals/comments. This keeps false positives near zero.
 *
 * Each declared name is tokenized on camelCase/PascalCase transitions, acronym
 * runs, underscores, and digit groups, then each lowercased token is compared
 * **whole** (never as a substring) against the `DENYLIST`. Whole-token matching
 * is the crux of the "no substring regex" rule: `configuration` →
 * `["configuration"]` (≠ `cfg`) and `repository` → `["repository"]` (≠ `repo`)
 * both pass, while `cfg` and `repoRoot` are caught.
 *
 * The baseline is one notch finer than `check-bun-native.ts`'s per-file
 * baseline: a sorted JSON array of `"<relativeFile>\t<token>"` keys, because
 * abbreviations are name-specific. A `(file, token)` pair in the baseline is
 * allowed; a pair *not* in the baseline is a hard failure (exit 1). A baseline
 * pair that no longer appears is reported as stale (also exit 1) so the debt
 * burns down. Run with `--update` to regenerate the baseline from the live tree.
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`, writes with
 * `Bun.write`. No node:fs sync APIs.
 */

import { join } from "node:path";
import { parseSync } from "oxc-parser";

const REPO_ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", ".abbreviation-baseline.json");

/** Source roots scanned for violations (relative to the repo root). */
export const SCAN_GLOBS = ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"];

/**
 * The denylist — single source of truth mapping each banned abbreviation token
 * to the full word(s) it should be spelled out as. Kept intentionally
 * conservative (the unambiguous tokens named in the issue). Pervasive idiomatic
 * tokens (`ctx`, `err`, `req`, `res`, `fn`) are out of v1 — they would balloon
 * the baseline for little signal and can be ratcheted in later by adding a
 * denylist entry plus `--update`.
 */
export const DENYLIST: Readonly<Record<string, string>> = {
  cfg: "config",
  tmp: "temporary",
  msg: "message",
  idx: "index",
  acc: "account/accumulator",
  pct: "percentage",
  repo: "repository",
  doc: "document",
};

const NEWLINE_CODE = 10;

/** Test files are exempt — they legitimately exercise abbreviated fixtures. */
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

/**
 * Split an identifier into lowercase word tokens on camelCase/PascalCase
 * transitions, acronym runs, underscores/non-alphanumerics, and digit groups.
 *
 * `repoRoot` → `["repo","root"]`, `parseURL` → `["parse","url"]`,
 * `tmp_dir` → `["tmp","dir"]`, `cfg2` → `["cfg","2"]`.
 */
export function tokenize(name: string): string[] {
  const tokens: string[] = [];
  // Each match is one run: an acronym+word (`URLParser`→`URL`,`Parser`), a
  // capitalized or lowercase word, or a digit run. Non-alphanumerics (incl.
  // underscores) are simply skipped by not being captured.
  const tokenRe = /[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+|[0-9]+/g;
  for (const match of name.matchAll(tokenRe)) {
    tokens.push(match[0].toLowerCase());
  }
  return tokens;
}

/** Return the suggested full word for a denylisted token, or null otherwise. */
export function classifyToken(token: string): string | null {
  return DENYLIST[token] ?? null;
}

export interface Occurrence {
  token: string;
  line: number;
  suggestion: string;
}

type AstNode = { type: string; [key: string]: unknown };

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index && position < source.length; position += 1) {
    if (source.charCodeAt(position) === NEWLINE_CODE) line += 1;
  }
  return line;
}

const SKIPPED_AST_KEYS = new Set(["start", "end", "loc", "range", "typeAnnotation"]);

interface CollectContext {
  source: string;
  occurrences: Occurrence[];
}

/** Record every denylisted token found in `name`, anchored at `index`. */
function recordName(name: string, index: number, ctx: CollectContext): void {
  const line = lineAt(ctx.source, index);
  for (const token of tokenize(name)) {
    const suggestion = classifyToken(token);
    if (suggestion) ctx.occurrences.push({ token, line, suggestion });
  }
}

/**
 * Collect every binding name introduced by a declaration pattern (an
 * Identifier, or the names bound inside object/array destructuring, defaults,
 * rest elements, and TS parameter properties).
 */
function collectBindingNames(pattern: unknown, ctx: CollectContext): void {
  if (!isAstNode(pattern)) return;
  switch (pattern.type) {
    case "Identifier": {
      if (typeof pattern.name === "string" && typeof pattern.start === "number") {
        recordName(pattern.name, pattern.start, ctx);
      }
      return;
    }
    case "ObjectPattern": {
      const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
      for (const property of properties) {
        if (!isAstNode(property)) continue;
        // For `{ a: b }` the *bound* name is the value (`b`); for shorthand
        // `{ msg }` value and key are the same identifier. A RestElement
        // (`...rest`) binds its argument.
        if (property.type === "RestElement") collectBindingNames(property.argument, ctx);
        else collectBindingNames(property.value, ctx);
      }
      return;
    }
    case "ArrayPattern": {
      const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
      for (const element of elements) collectBindingNames(element, ctx);
      return;
    }
    case "AssignmentPattern": {
      collectBindingNames(pattern.left, ctx);
      return;
    }
    case "RestElement": {
      collectBindingNames(pattern.argument, ctx);
      return;
    }
    case "TSParameterProperty": {
      collectBindingNames(pattern.parameter, ctx);
      return;
    }
    default:
      return;
  }
}

function recordDeclarationId(node: AstNode, ctx: CollectContext): void {
  const id = node.id;
  if (isAstNode(id) && id.type === "Identifier" && typeof id.name === "string") {
    if (typeof id.start === "number") recordName(id.name, id.start, ctx);
  }
}

function collectParams(node: AstNode, ctx: CollectContext): void {
  const params = Array.isArray(node.params) ? node.params : [];
  for (const param of params) collectBindingNames(param, ctx);
}

/**
 * Walk the AST recording declared identifier names only. The switch records via
 * explicit `collectBindingNames`/`recordDeclarationId`/`collectParams` calls;
 * the generic descent never records a bare Identifier, so references, object
 * keys, and member-access names are left untouched (no double counting).
 */
function walk(node: unknown, ctx: CollectContext): void {
  if (!isAstNode(node)) return;
  switch (node.type) {
    case "VariableDeclarator":
      collectBindingNames(node.id, ctx);
      break;
    case "FunctionDeclaration":
    case "FunctionExpression":
      recordDeclarationId(node, ctx);
      collectParams(node, ctx);
      break;
    case "ArrowFunctionExpression":
      collectParams(node, ctx);
      break;
    case "ClassDeclaration":
    case "ClassExpression":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
      recordDeclarationId(node, ctx);
      break;
    default:
      break;
  }
  for (const key of Object.keys(node)) {
    if (SKIPPED_AST_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) walk(item, ctx);
    } else if (value && typeof value === "object") {
      walk(value, ctx);
    }
  }
}

/**
 * Parse `source` and return every denylisted-token occurrence on a declared
 * identifier. Returns an empty array for sources that fail to parse.
 */
export function extractOccurrences(source: string): Occurrence[] {
  let parsed;
  try {
    parsed = parseSync("file.tsx", source, { lang: "tsx" });
  } catch {
    return [];
  }
  const program = parsed.program;
  if (!isAstNode(program)) return [];
  const ctx: CollectContext = { source, occurrences: [] };
  walk(program, ctx);
  return ctx.occurrences;
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

/** The key separator joining a relative file path to a token in the baseline. */
export const PAIR_SEPARATOR = "\t";

export function makePairKey(file: string, token: string): string {
  return `${file}${PAIR_SEPARATOR}${token}`;
}

/**
 * Scan every in-scope source file and return a map keyed by
 * `"<relativeFile>\t<token>"` to the occurrences contributing to that pair.
 */
export async function scanTree(root: string): Promise<Map<string, Occurrence[]>> {
  const pairs = new Map<string, Occurrence[]>();
  for (const rel of await collectSourceFiles(root)) {
    const content = await Bun.file(join(root, rel)).text();
    for (const occurrence of extractOccurrences(content)) {
      const key = makePairKey(rel, occurrence.token);
      const list = pairs.get(key) ?? [];
      list.push(occurrence);
      pairs.set(key, list);
    }
  }
  return pairs;
}

async function loadBaseline(): Promise<string[]> {
  const file = Bun.file(BASELINE_PATH);
  if (!(await file.exists())) return [];
  const parsed: unknown = JSON.parse(await file.text());
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => String(entry).replaceAll("\\", "/"));
}

async function writeBaseline(pairKeys: string[]): Promise<void> {
  await Bun.write(BASELINE_PATH, `${JSON.stringify(pairKeys, null, 2)}\n`);
}

export interface BaselineComparison {
  /** Pair keys present now but absent from the baseline — hard failures. */
  newViolations: string[];
  /** Baseline pair keys no longer present — must be removed from the baseline. */
  staleEntries: string[];
}

/** Compare current `(file, token)` pair keys against the baseline pair keys. */
export function compareToBaseline(
  currentPairKeys: Iterable<string>,
  baselinePairKeys: Iterable<string>,
): BaselineComparison {
  const current = new Set(currentPairKeys);
  const baseline = new Set(baselinePairKeys);
  const newViolations = [...current].filter((key) => !baseline.has(key)).sort();
  const staleEntries = [...baseline].filter((key) => !current.has(key)).sort();
  return { newViolations, staleEntries };
}

function describePair(key: string, occurrences: Occurrence[]): string[] {
  const [file, token] = key.split(PAIR_SEPARATOR);
  return occurrences.map((occurrence) => {
    const suggestion = occurrence.suggestion;
    return `  ${file}:${occurrence.line}  ${token} → ${suggestion}`;
  });
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const pairs = await scanTree(REPO_ROOT);
  const currentPairKeys = [...pairs.keys()].sort();

  if (update) {
    await writeBaseline(currentPairKeys);
    console.log(
      `✓ Wrote ${currentPairKeys.length} grandfathered (file, token) pair(s) to ${BASELINE_PATH}`,
    );
    return;
  }

  const baseline = await loadBaseline();
  const { newViolations, staleEntries } = compareToBaseline(currentPairKeys, baseline);

  if (newViolations.length === 0 && staleEntries.length === 0) {
    console.log(
      `✓ No new abbreviated identifiers (${baseline.length} grandfathered (file, token) pair(s) in baseline)`,
    );
    return;
  }

  if (newViolations.length > 0) {
    console.error(
      `✘ Found new abbreviated identifiers in ${newViolations.length} non-baselined (file, token) pair(s):\n`,
    );
    for (const key of newViolations) {
      for (const line of describePair(key, pairs.get(key) ?? [])) console.error(line);
    }
    console.error("");
  }

  if (staleEntries.length > 0) {
    console.error(
      `✘ ${staleEntries.length} baseline pair(s) no longer appear — remove them from ${BASELINE_PATH}:\n`,
    );
    for (const key of staleEntries) {
      const [file, token] = key.split(PAIR_SEPARATOR);
      console.error(`  ${file}  ${token}`);
    }
    console.error("");
  }

  console.error(
    "Spell names out (see CLAUDE.md). Rename the identifier, or — only when\n" +
      "intentionally grandfathering existing debt — run `bun scripts/check-no-abbreviation.ts --update`.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
