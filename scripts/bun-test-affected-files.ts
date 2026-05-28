#!/usr/bin/env bun
/**
 * bun-test-affected-files
 *
 * Runs bun test only on test files relevant to changed source files
 * within affected projects. Similar to Jest's --findRelatedTests.
 *
 * Usage: bun scripts/bun-test-affected-files.ts [--coverage]
 *
 * How it works:
 *   1. Uses `nx show projects --affected -t test` to get affected projects
 *   2. Gets changed files (git diff against NX_BASE or merge-base with main)
 *   3. For each affected project, filters changed files to its src/ directory
 *   4. Maps changed source files → corresponding .test.ts/.spec.ts files
 *   5. Includes changed test files directly
 *   6. Runs `bun test` per project with only the relevant files
 *
 * Respects NX_BASE/NX_HEAD env vars (set by nrwl/nx-set-shas in CI).
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const TEST_EXTENSIONS = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function isTestFile(filePath: string): boolean {
  return TEST_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function findRelatedTestFiles(sourceFile: string): string[] {
  const results: string[] = [];
  for (const srcExt of SOURCE_EXTENSIONS) {
    if (!sourceFile.endsWith(srcExt)) continue;
    const base = sourceFile.slice(0, -srcExt.length);
    for (const testExt of TEST_EXTENSIONS) {
      if (!testExt.endsWith(srcExt)) continue;
      const candidate = base + testExt;
      if (existsSync(candidate)) {
        results.push(candidate);
      }
    }
  }
  return results;
}

async function run(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr}`);
  }
  return stdout.trim();
}

async function getChangedFiles(workspaceRoot: string): Promise<string[]> {
  const base = process.env["NX_BASE"] || (await run(["git", "merge-base", "HEAD", "main"]));
  const head = process.env["NX_HEAD"] || "HEAD";

  const committed = await run(["git", "diff", "--name-only", "--diff-filter=ACMR", base, head]);
  const uncommitted = await run(["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"]);

  const files = new Set<string>();
  for (const line of [...committed.split("\n"), ...uncommitted.split("\n")]) {
    if (line.length > 0) files.add(resolve(workspaceRoot, line));
  }
  return [...files];
}

interface ProjectInfo {
  name: string;
  root: string;
  sourceRoot: string;
}

async function getAffectedProjects(workspaceRoot: string): Promise<ProjectInfo[]> {
  const namesJson = await run(
    ["bun", "nx", "show", "projects", "--affected", "--json", "-t", "test"],
    workspaceRoot,
  );
  const names: string[] = JSON.parse(namesJson);

  const projects: ProjectInfo[] = [];
  for (const name of names) {
    const projectJson = await run(["bun", "nx", "show", "project", name, "--json"], workspaceRoot);
    const project = JSON.parse(projectJson);
    projects.push({
      name,
      root: project.root,
      sourceRoot: project.sourceRoot ?? `${project.root}/src`,
    });
  }
  return projects;
}

/** Returns top-level directories inside projectRoot that contain test files. */
async function collectTestDirs(projectRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(projectRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    dirs.push(join(projectRoot, entry.name));
  }
  return dirs;
}

function collectTestFiles(changedFiles: string[], projectSrcRoot: string): string[] {
  const projectFiles = changedFiles.filter((f) => f.startsWith(projectSrcRoot));
  const testFiles = new Set<string>();

  for (const file of projectFiles) {
    if (isTestFile(file)) {
      testFiles.add(file);
    } else if (SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext))) {
      for (const testFile of findRelatedTestFiles(file)) {
        testFiles.add(testFile);
      }
    }
  }

  return [...testFiles];
}

async function main(): Promise<void> {
  const coverage = process.argv.includes("--coverage");
  const workspaceRoot = resolve(import.meta.dirname, "..");

  console.log("Detecting affected projects...\n");
  const [changedFiles, projects] = await Promise.all([
    getChangedFiles(workspaceRoot),
    getAffectedProjects(workspaceRoot),
  ]);

  let hasFailure = false;
  let totalTestFiles = 0;

  for (const project of projects) {
    const srcRoot = resolve(workspaceRoot, project.sourceRoot);
    const testFiles = collectTestFiles(changedFiles, srcRoot);

    if (testFiles.length === 0) {
      console.log(`${project.name}: no relevant test files`);
      continue;
    }

    totalTestFiles += testFiles.length;
    console.log(`${project.name}: ${testFiles.length} relevant test file(s)`);
    for (const f of testFiles) {
      console.log(`  ${f.replace(workspaceRoot + "/", "")}`);
    }
    console.log();

    // With --coverage, run ALL project tests — coverage thresholds are only
    // meaningful across the full suite; passing a subset under-reports and
    // trips per-file thresholds for untouched source files.
    // Pass top-level source directories explicitly to avoid a bun 1.3.14 bug
    // where `bun test --coverage` without paths exits 1 despite 0 failures.
    const allTestDirs = coverage
      ? await collectTestDirs(resolve(workspaceRoot, project.root))
      : null;
    const args = coverage ? ["test", "--coverage", ...allTestDirs!] : ["test", ...testFiles];
    const proc = Bun.spawn(["bun", ...args], {
      cwd: resolve(workspaceRoot, project.root),
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      hasFailure = true;
    }
  }

  if (totalTestFiles === 0) {
    console.log("\nNo relevant test files found across affected projects.");
  }

  process.exit(hasFailure ? 1 : 0);
}

main();
