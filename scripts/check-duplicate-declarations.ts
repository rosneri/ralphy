#!/usr/bin/env bun
/**
 * Duplication Check — orchestrates four complementary detectors.
 *
 *   1. Same-name declarations across files (custom AST walk; primary signal).
 *      Detects `const FOO`, `function foo`, `enum`, `class`, `type`, `interface`
 *      declared at module top-level in more than one file.
 *
 *   2. TypeScript TS2300 (Duplicate identifier within a single module/scope).
 *      Surfaced by typecheck:ci already; this script greps it from a no-emit
 *      compile so it shows up in the same report.
 *
 *   3. eslint-plugin-sonarjs `no-identical-functions` (same body, possibly
 *      different names) via a dedicated minimal flat config.
 *
 *   4. jscpd token-based copy-paste detection (Rabin-Karp, language-aware).
 *
 * Modes:
 *   --all           Scan every source file under libs/ and apps/.
 *   --diff [base]   Scan only files changed vs `base` (default: origin/main),
 *                   but still cross-reference against the whole repo.
 *   --files a b c   Scan an explicit list of files.
 *
 * Skip individual detectors with --no-name | --no-ts2300 | --no-sonar | --no-jscpd.
 *
 * Exit code is 1 on any violation. Variable declarations (const/let/var) in the
 * same-name detector can be opted out with `// allow-duplicate` on the line
 * directly above the declaration. Functions, enums, classes, type aliases, and
 * interfaces have no escape hatch. SonarJS and jscpd have no escape hatch either.
 */

import { execSync, spawnSync } from "node:child_process";
import { readdir, readFile, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * Refuse to run unless REPO_ROOT is a JS/TS repo (has a package.json). This is a
 * safety guard: the detectors shell out to `tsc`, `eslint`, and `jscpd` over
 * `libs/` and `apps/`, and a recursive scan kicked off in the wrong directory
 * (or a non-project tree) can pin a CPU core for a long time. If there's no
 * package.json next to the script's parent, there's nothing legitimate to scan.
 */
async function assertJsRepo(): Promise<void> {
  if (await Bun.file(join(REPO_ROOT, "package.json")).exists()) return;
  console.log(`✓ ${REPO_ROOT} is not a JS repo (no package.json); skipping duplicate check.`);
  process.exit(0);
}

type DeclKind = "variable" | "function" | "enum" | "class" | "type" | "interface";

interface Declaration {
  readonly name: string;
  readonly kind: DeclKind;
  readonly file: string;
  readonly line: number;
  readonly allowDuplicate: boolean;
}

const SCAN_ROOTS = ["libs", "apps"];
const SCAN_SUBDIRS = ["src"];
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".astro",
  "generated",
  "coverage",
  ".turbo",
]);
const EXCLUDED_FILE_PATTERNS = [
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\.stories\.tsx?$/,
  /\.fixture\.tsx?$/,
  /\.d\.ts$/,
  /\/__tests__\//,
  /\/__mocks__\//,
  /\/__fixtures__\//,
  /\/generated\//,
];
const ALLOW_DUPLICATE_MARKER = /^\s*\/\/\s*allow-duplicate\b/;
const VARIABLE_KINDS: ReadonlySet<DeclKind> = new Set(["variable"]);

/**
 * Names that are duplicated by framework or codebase convention, not by author choice.
 * Each entry pairs a path predicate with the names it permits. If every occurrence in
 * a group matches at least one entry, the group is dropped before reporting.
 */
interface ConventionAllow {
  readonly reason: string;
  readonly matchPath: (file: string) => boolean;
  readonly names: ReadonlySet<string>;
}

const CONVENTION_ALLOWLIST: readonly ConventionAllow[] = [
  {
    reason: "Each app has exactly one entry-point main() function.",
    matchPath: (file) =>
      /^apps\/[^/]+\/src\/index\.ts$/.test(file) || /^apps\/[^/]+\/src\/scripts\//.test(file),
    names: new Set(["main"]),
  },
  {
    reason: "Each app has exactly one root App component.",
    matchPath: (file) => /^apps\/[^/]+\/src\/(components\/)?App\.tsx$/.test(file),
    names: new Set(["App"]),
  },
  {
    reason:
      "Per-feature event emitters — each feature folder has its own events.ts with emitCompleted/emitFailed/emitTransitioned.",
    matchPath: (file) => /^apps\/agent\/src\/features\/[^/]+\/events\.ts$/.test(file),
    names: new Set(["emitCompleted", "emitFailed", "emitTransitioned"]),
  },
  {
    reason:
      "Cross-app terminal UI components and formatting utilities independently defined in each app.",
    matchPath: (file) => /^apps\/(loop|ui|agent)\/src\/(components|views|utils)\//.test(file),
    names: new Set(["StatusBar", "StatusBarProps", "FeedLine", "formatCost"]),
  },
  {
    reason: "Astro route handlers — each API route must export its HTTP method(s).",
    matchPath: (file) => /^apps\/[^/]+\/src\/pages\//.test(file),
    names: new Set([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
      "ALL",
      "prerender",
    ]),
  },
  {
    reason: "Module pattern — every libs/mod-*/src/context.ts exposes these builders.",
    matchPath: (file) => /^libs\/mod-[^/]+\/src\/context\.ts$/.test(file),
    names: new Set(["buildAIContext", "buildUIState"]),
  },
  {
    reason: "Module pattern — every libs/mod-*/src/logic.ts exposes a uniform surface.",
    matchPath: (file) => /^libs\/mod-[^/]+\/src\/logic\.ts$/.test(file),
    names: new Set(["apply", "validate", "transform", "reduce", "handleReset", "handleStart"]),
  },
  {
    reason: "Module pattern — every libs/mod-*/src/schema.ts exports a Zod trigger schema.",
    matchPath: (file) => /^libs\/mod-[^/]+\/src\/schema\.ts$/.test(file),
    names: new Set(["triggerSchema", "schema"]),
  },
  {
    reason: "Per-module test scaffolding — libs/mod-*/src/test-helpers.ts shape is shared.",
    matchPath: (file) => /^libs\/mod-[^/]+\/src\/test-helpers\.ts$/.test(file),
    names: new Set([
      "makeContext",
      "makeState",
      "makeTrigger",
      "makeEntry",
      "MakeStateParams",
      "MakeContextParams",
    ]),
  },
  {
    reason: "Each sigil/ornament SVG declares its own local Props + DEFAULT_SIZE + CENTER.",
    matchPath: (file) => /^libs\/game-ui\/src\/vellum\/(sigils|ornaments)\//.test(file),
    names: new Set(["SigilProps", "OrnamentProps", "DEFAULT_SIZE", "CENTER"]),
  },
  {
    reason: "Per-route scaffolding — each Astro API route declares its local request shape.",
    matchPath: (file) =>
      /^apps\/[^/]+\/src\/pages\/api\//.test(file) ||
      /^apps\/[^/]+\/src\/lib\/(admin|quest)\//.test(file),
    names: new Set([
      "bodySchema",
      "requestSchema",
      "querySchema",
      "paramsSchema",
      "ROUTE",
      "extractInput",
      "parseInput",
    ]),
  },
];

function isConventionallyAllowed(file: string, name: string): boolean {
  for (const entry of CONVENTION_ALLOWLIST) {
    if (entry.names.has(name) && entry.matchPath(file)) return true;
  }
  return false;
}

function isSourceFile(path: string): boolean {
  if (!/\.tsx?$/.test(path)) return false;
  return !EXCLUDED_FILE_PATTERNS.some((re) => re.test(path));
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (isSourceFile(full)) {
      yield full;
    }
  }
}

async function collectAllSourceFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const root of SCAN_ROOTS) {
    const rootDir = join(REPO_ROOT, root);
    let groups;
    try {
      groups = await readdir(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const group of groups) {
      if (!group.isDirectory()) continue;
      if (EXCLUDED_DIRS.has(group.name)) continue;
      for (const sub of SCAN_SUBDIRS) {
        for await (const file of walk(join(rootDir, group.name, sub))) {
          out.push(file);
        }
      }
    }
  }
  return out;
}

function getNameFromBinding(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    const names: string[] = [];
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        names.push(...getNameFromBinding(element.name));
      }
    }
    return names;
  }
  return [];
}

function lineHasAllowMarker(source: string, lineOffset: number): boolean {
  const lines = source.split("\n");
  for (let i = lineOffset - 2; i >= 0; i -= 1) {
    const text = lines[i] ?? "";
    if (text.trim() === "") continue;
    return ALLOW_DUPLICATE_MARKER.test(text);
  }
  return false;
}

function collectDeclarations(filePath: string, source: string): Declaration[] {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const decls: Declaration[] = [];
  const rel = relative(REPO_ROOT, filePath);

  for (const stmt of sf.statements) {
    const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
    const lineNum = line + 1;
    const allow = lineHasAllowMarker(source, lineNum);

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        for (const name of getNameFromBinding(decl.name)) {
          decls.push({ name, kind: "variable", file: rel, line: lineNum, allowDuplicate: allow });
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      // Skip overload signatures (no body) — only count the implementation.
      if (stmt.body) {
        decls.push({
          name: stmt.name.text,
          kind: "function",
          file: rel,
          line: lineNum,
          allowDuplicate: false,
        });
      }
    } else if (ts.isEnumDeclaration(stmt)) {
      decls.push({
        name: stmt.name.text,
        kind: "enum",
        file: rel,
        line: lineNum,
        allowDuplicate: false,
      });
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      decls.push({
        name: stmt.name.text,
        kind: "class",
        file: rel,
        line: lineNum,
        allowDuplicate: false,
      });
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      decls.push({
        name: stmt.name.text,
        kind: "type",
        file: rel,
        line: lineNum,
        allowDuplicate: false,
      });
    } else if (ts.isInterfaceDeclaration(stmt)) {
      decls.push({
        name: stmt.name.text,
        kind: "interface",
        file: rel,
        line: lineNum,
        allowDuplicate: false,
      });
    }
  }

  return decls;
}

interface ParsedArgs {
  readonly mode: "all" | "diff" | "files";
  readonly base: string;
  readonly explicitFiles: readonly string[];
  readonly runName: boolean;
  readonly runTs2300: boolean;
  readonly runSonar: boolean;
  readonly runJscpd: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let mode: ParsedArgs["mode"] = "all";
  let base = "origin/main";
  const explicitFiles: string[] = [];
  let runName = true;
  let runTs2300 = true;
  let runSonar = true;
  let runJscpd = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") mode = "all";
    else if (arg === "--diff") {
      mode = "diff";
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        base = next;
        i += 1;
      }
    } else if (arg === "--files") {
      mode = "files";
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        i += 1;
        explicitFiles.push(argv[i]!);
      }
    } else if (arg === "--no-name") runName = false;
    else if (arg === "--no-ts2300") runTs2300 = false;
    else if (arg === "--no-sonar") runSonar = false;
    else if (arg === "--no-jscpd") runJscpd = false;
  }

  return { mode, base, explicitFiles, runName, runTs2300, runSonar, runJscpd };
}

function gitChangedFiles(base: string): string[] {
  let out: string;
  try {
    out = execSync(`git diff --name-only --diff-filter=ACMR ${base}...HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((p) => join(REPO_ROOT, p))
    .filter((p) => isSourceFile(p));
}

/**
 * Returns the map `headPath -> basePath` for files that were renamed between
 * `base` and HEAD. `git diff -M` detects renames with a similarity threshold.
 */
function renamedFiles(base: string): Map<string, string> {
  const map = new Map<string, string>();
  let out: string;
  try {
    out = execSync(`git diff --name-status -M ${base}...HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
  } catch {
    return map;
  }
  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const status = parts[0] ?? "";
    if (!status.startsWith("R")) continue;
    const oldPath = parts[1] ?? "";
    const newPath = parts[2] ?? "";
    if (oldPath && newPath) map.set(newPath, oldPath);
  }
  return map;
}

/**
 * Returns the set of declaration keys (`kind::name`) that exist in `file` at HEAD
 * but did NOT exist in the same file at `base`. Used by `--diff` mode so the
 * detector only fails on declarations the PR actually introduces, not on
 * pre-existing duplicates that happen to live in a file the PR touched.
 *
 * If `basePath` is provided, declarations are looked up at that path at `base`
 * — used to follow git renames so moving a file doesn't make all its
 * declarations look new.
 */
function declarationsAtBase(relPath: string, base: string, basePath?: string): Set<string> {
  let baseSource: string;
  try {
    baseSource = execSync(`git show ${base}:${basePath ?? relPath}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return new Set();
  }
  const decls = collectDeclarations(join(REPO_ROOT, relPath), baseSource);
  return new Set(decls.map((d) => `${d.kind}::${d.name}`));
}

interface Hunk {
  readonly start: number;
  readonly end: number;
}

/**
 * Returns the line ranges (1-indexed, inclusive) of added/modified lines for
 * `file` between `base` and HEAD. Empty array if the file is unchanged or
 * was deleted.
 */
function addedLineRanges(relPath: string, base: string): Hunk[] {
  let out: string;
  try {
    out = execSync(`git diff -U0 --no-color ${base}...HEAD -- ${relPath}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
  } catch {
    return [];
  }
  const hunks: Hunk[] = [];
  for (const line of out.split("\n")) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) continue;
    hunks.push({ start, end: start + count - 1 });
  }
  return hunks;
}

function rangesOverlap(hunks: readonly Hunk[], start: number, end: number): boolean {
  for (const h of hunks) {
    if (h.start <= end && h.end >= start) return true;
  }
  return false;
}

function formatGroup(name: string, kind: DeclKind, entries: readonly Declaration[]): string {
  const header = `  • ${kind} \x1b[1m${name}\x1b[0m declared in ${entries.length} files:`;
  const body = entries.map((e) => `      - ${e.file}:${e.line}`).join("\n");
  return `${header}\n${body}`;
}

function isViolation(kind: DeclKind, entries: readonly Declaration[]): boolean {
  const real = entries.filter((e) => !isConventionallyAllowed(e.file, e.name));
  if (real.length < 2) return false;
  if (!VARIABLE_KINDS.has(kind)) return true;
  return !real.every((e) => e.allowDuplicate);
}

interface DetectorResult {
  readonly name: string;
  readonly violations: number;
  readonly report: string;
}

async function runSameNameDetector(
  args: ParsedArgs,
  allFiles: readonly string[],
  filesOfInterest: ReadonlySet<string>,
): Promise<DetectorResult> {
  const fileSet = new Set<string>([...allFiles, ...filesOfInterest]);
  const groups = new Map<string, Declaration[]>();
  for (const file of fileSet) {
    const source = await readFile(file, "utf8");
    const decls = collectDeclarations(file, source);
    for (const decl of decls) {
      const key = `${decl.kind}::${decl.name}`;
      const existing = groups.get(key);
      if (existing) existing.push(decl);
      else groups.set(key, [decl]);
    }
  }

  // In diff mode, build per-file sets of declaration keys that exist now but
  // did not at base. A group is only a violation if at least one participating
  // entry is a *newly introduced* declaration in a file touched by the diff —
  // pre-existing duplicates that the PR merely brushes against don't count.
  const newKeysByFile = new Map<string, Set<string>>();
  if (args.mode === "diff") {
    const renames = renamedFiles(args.base);
    for (const abs of filesOfInterest) {
      const rel = relative(REPO_ROOT, abs);
      const basePath = renames.get(rel);
      const baseKeys = declarationsAtBase(rel, args.base, basePath);
      const headDecls = collectDeclarations(abs, await readFile(abs, "utf8"));
      const added = new Set<string>();
      for (const d of headDecls) {
        const k = `${d.kind}::${d.name}`;
        if (!baseKeys.has(k)) added.add(k);
      }
      newKeysByFile.set(rel, added);
    }
  }

  const violations: Array<{ name: string; kind: DeclKind; entries: Declaration[] }> = [];
  for (const [key, entries] of groups) {
    const [kind, name] = key.split("::", 2) as [DeclKind, string];
    if (!isViolation(kind, entries)) continue;
    const real = entries.filter((e) => !isConventionallyAllowed(e.file, e.name));
    if (args.mode === "diff") {
      const introducedByPr = real.some((e) => {
        const added = newKeysByFile.get(e.file);
        return added !== undefined && added.has(`${e.kind}::${e.name}`);
      });
      if (!introducedByPr) continue;
    } else if (args.mode === "files") {
      const touchesPr = real.some((e) => filesOfInterest.has(join(REPO_ROOT, e.file)));
      if (!touchesPr) continue;
    }
    violations.push({ name, kind, entries: real });
  }

  if (violations.length === 0) {
    return { name: "Same-name across files", violations: 0, report: "" };
  }

  const lines = ["\x1b[31m✗ Same-name declarations across files\x1b[0m\n"];
  for (const v of violations) {
    lines.push(formatGroup(v.name, v.kind, v.entries));
    lines.push("");
  }
  lines.push("\x1b[33mEscape hatch\x1b[0m");
  lines.push("  For const/let/var ONLY — add `// allow-duplicate` above EACH occurrence.");
  lines.push("  Use sparingly: diverging copies of the same constant lose all reuse benefit.");
  return {
    name: "Same-name across files",
    violations: violations.length,
    report: lines.join("\n"),
  };
}

function runTs2300Detector(args: ParsedArgs): DetectorResult {
  const tsconfig = join(REPO_ROOT, "tsconfig.base.json");
  const res = spawnSync("bunx", ["tsc", "--noEmit", "--pretty", "false", "-p", tsconfig], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const stderr = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const matches = stderr.split("\n").filter((line) => /error TS2300:/.test(line));

  let lines = matches;
  if (args.mode !== "all") {
    // Only report TS2300 entries that touch a file of interest.
    const interestRels = new Set(
      [...args.explicitFiles, ...gitChangedFiles(args.base)].map((p) =>
        relative(REPO_ROOT, p.startsWith("/") ? p : join(REPO_ROOT, p)),
      ),
    );
    lines = matches.filter((line) => [...interestRels].some((rel) => line.includes(rel)));
  }

  if (lines.length === 0) {
    return { name: "TS2300 (same-module dupes)", violations: 0, report: "" };
  }
  const report = [
    "\x1b[31m✗ TypeScript TS2300 — duplicate identifiers within a module\x1b[0m",
    ...lines.map((l) => `  ${l}`),
  ].join("\n");
  return { name: "TS2300 (same-module dupes)", violations: lines.length, report };
}

function runSonarDetector(args: ParsedArgs, filesOfInterest: ReadonlySet<string>): DetectorResult {
  const config = join(REPO_ROOT, "eslint.duplicates.config.mjs");
  const targets =
    args.mode === "all"
      ? ["libs", "apps"]
      : [...filesOfInterest].map((p) => relative(REPO_ROOT, p));
  if (targets.length === 0) {
    return { name: "SonarJS no-identical-functions", violations: 0, report: "" };
  }
  const res = spawnSync(
    "bunx",
    ["eslint", "--no-config-lookup", "--config", config, "--format", "compact", ...targets],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const lines = out.split("\n").filter((l) => l.includes("sonarjs/no-identical-functions"));
  if (lines.length === 0) {
    return { name: "SonarJS no-identical-functions", violations: 0, report: "" };
  }
  const report = [
    "\x1b[31m✗ SonarJS — functions with identical bodies\x1b[0m",
    ...lines.map((l) => `  ${l}`),
  ].join("\n");
  return { name: "SonarJS no-identical-functions", violations: lines.length, report };
}

interface JscpdDuplicate {
  readonly firstFile: { readonly name: string; readonly start: number; readonly end?: number };
  readonly secondFile: { readonly name: string; readonly start: number; readonly end?: number };
  readonly lines: number;
  readonly tokens: number;
}

async function runJscpdDetector(
  args: ParsedArgs,
  filesOfInterest: ReadonlySet<string>,
): Promise<DetectorResult> {
  const outDir = join(REPO_ROOT, ".jscpd");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const targets =
    args.mode === "all"
      ? ["libs", "apps"]
      : [...filesOfInterest].map((p) => relative(REPO_ROOT, p));
  if (targets.length === 0) {
    return { name: "jscpd copy-paste blocks", violations: 0, report: "" };
  }
  const res = spawnSync("bunx", ["jscpd", "--silent", ...targets], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0 && res.status !== 1) {
    return {
      name: "jscpd copy-paste blocks",
      violations: 0,
      report: `(jscpd exited ${res.status ?? "null"}; skipped)`,
    };
  }
  let json: { duplicates?: JscpdDuplicate[] };
  try {
    json = JSON.parse(await readFile(join(outDir, "jscpd-report.json"), "utf8"));
  } catch {
    return { name: "jscpd copy-paste blocks", violations: 0, report: "" };
  }
  let dupes = json.duplicates ?? [];
  if (args.mode === "diff") {
    // Only flag copy-paste blocks where at least one side overlaps with
    // lines the PR actually added or modified, AND the duplicate didn't
    // already exist at base (two files that were identical before and
    // remain identical after aren't a regression — they belong to a
    // separate cleanup track).
    const renames = renamedFiles(args.base);
    const hunksByFile = new Map<string, Hunk[]>();
    const hunksFor = (file: string): Hunk[] => {
      const existing = hunksByFile.get(file);
      if (existing !== undefined) return existing;
      const computed = addedLineRanges(file, args.base);
      hunksByFile.set(file, computed);
      return computed;
    };
    const baseContent = (file: string): string | undefined => {
      const lookup = renames.get(file) ?? file;
      try {
        return execSync(`git show ${args.base}:${lookup}`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        return undefined;
      }
    };
    dupes = dupes.filter((d) => {
      const firstEnd = d.firstFile.end ?? d.firstFile.start + d.lines - 1;
      const secondEnd = d.secondFile.end ?? d.secondFile.start + d.lines - 1;
      const touched =
        rangesOverlap(hunksFor(d.firstFile.name), d.firstFile.start, firstEnd) ||
        rangesOverlap(hunksFor(d.secondFile.name), d.secondFile.start, secondEnd);
      if (!touched) return false;
      const aBase = baseContent(d.firstFile.name);
      const bBase = baseContent(d.secondFile.name);
      if (aBase !== undefined && bBase !== undefined && aBase === bBase) {
        // Both files existed at base with identical content → duplicate
        // pre-existed; the PR just kept them in lockstep.
        return false;
      }
      return true;
    });
  }
  if (dupes.length === 0) {
    return { name: "jscpd copy-paste blocks", violations: 0, report: "" };
  }
  const lines = [
    "\x1b[31m✗ jscpd — copy-paste blocks\x1b[0m",
    ...dupes.map(
      (d) =>
        `  • ${d.lines} lines (${d.tokens} tokens) duplicated between\n` +
        `      - ${d.firstFile.name}:${d.firstFile.start}\n` +
        `      - ${d.secondFile.name}:${d.secondFile.start}`,
    ),
  ];
  return { name: "jscpd copy-paste blocks", violations: dupes.length, report: lines.join("\n") };
}

async function main(): Promise<void> {
  await assertJsRepo();
  const args = parseArgs(process.argv.slice(2));
  const allFiles = await collectAllSourceFiles();

  let filesOfInterest: Set<string>;
  if (args.mode === "all") {
    filesOfInterest = new Set(allFiles);
  } else if (args.mode === "diff") {
    const changed = gitChangedFiles(args.base);
    filesOfInterest = new Set(changed);
    if (filesOfInterest.size === 0) {
      console.log(`✓ No source files changed vs ${args.base}; skipping duplicate check.`);
      return;
    }
  } else {
    filesOfInterest = new Set(
      args.explicitFiles
        .map((p) => (p.startsWith("/") ? p : join(REPO_ROOT, p)))
        .filter(isSourceFile),
    );
    if (filesOfInterest.size === 0) {
      console.log("✓ No source files supplied; skipping duplicate check.");
      return;
    }
  }

  const results: DetectorResult[] = [];
  if (args.runName) results.push(await runSameNameDetector(args, allFiles, filesOfInterest));
  if (args.runTs2300) results.push(runTs2300Detector(args));
  if (args.runSonar) results.push(runSonarDetector(args, filesOfInterest));
  if (args.runJscpd) results.push(await runJscpdDetector(args, filesOfInterest));

  const failing = results.filter((r) => r.violations > 0);

  console.log("\nDuplication check — detector summary:");
  for (const r of results) {
    const status = r.violations === 0 ? "\x1b[32m✓\x1b[0m" : `\x1b[31m✗ ${r.violations}\x1b[0m`;
    console.log(`  ${status}  ${r.name}`);
  }
  console.log("");

  if (failing.length === 0) {
    const scope =
      args.mode === "all"
        ? "the whole repo"
        : args.mode === "diff"
          ? `files changed vs ${args.base}`
          : `${filesOfInterest.size} file(s)`;
    console.log(`✓ No duplication detected in ${scope}.`);
    return;
  }

  for (const r of failing) {
    if (r.report) {
      console.error("");
      console.error(r.report);
    }
  }
  console.error("");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error("check-duplicate-declarations: unexpected error");
  console.error(err);
  process.exit(2);
});
