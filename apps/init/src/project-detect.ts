/**
 * Best-effort autodetection of WORKFLOW.md defaults from the project on disk,
 * used to pre-populate the setup wizard. Everything here is non-fatal: a missing
 * or malformed file simply yields no suggestion, so the wizard falls back to its
 * own placeholders.
 */
import { join } from "node:path";

/** A package.json shape we read for scripts and dependency markers. */
interface PackageJson {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(projectRoot: string): Promise<PackageJson | null> {
  const file = Bun.file(join(projectRoot, "package.json"));
  if (!(await file.exists())) return null;
  try {
    return JSON.parse(await file.text()) as PackageJson;
  } catch {
    return null;
  }
}

async function fileExists(projectRoot: string, name: string): Promise<boolean> {
  return Bun.file(join(projectRoot, name)).exists();
}

/**
 * The package-manager run prefix for the project, inferred from its lockfile.
 * Defaults to `bun run` to match the wizard's Bun-centric command placeholders.
 */
async function detectRunPrefix(projectRoot: string): Promise<string> {
  const lockfiles: { file: string; prefix: string }[] = [
    { file: "bun.lock", prefix: "bun run" },
    { file: "bun.lockb", prefix: "bun run" },
    { file: "pnpm-lock.yaml", prefix: "pnpm run" },
    { file: "yarn.lock", prefix: "yarn run" },
    { file: "package-lock.json", prefix: "npm run" },
  ];
  for (const { file, prefix } of lockfiles) {
    if (await fileExists(projectRoot, file)) return prefix;
  }
  return "bun run";
}

/** package.json script names mapped to the WORKFLOW.md command field they fill. */
const COMMAND_FIELD_SCRIPTS: { field: string; scripts: string[] }[] = [
  { field: "commands.test", scripts: ["test"] },
  { field: "commands.lint", scripts: ["lint"] },
  { field: "commands.build", scripts: ["build"] },
  { field: "commands.typecheck", scripts: ["typecheck", "type-check", "tsc"] },
];

/**
 * Read the project's package.json scripts and map the well-known ones (test,
 * lint, build, typecheck) to WORKFLOW.md command field ids, each as a
 * `<run-prefix> <script>` invocation. Returns only the commands found.
 */
export async function detectCommandsFromPackageJson(
  projectRoot: string,
): Promise<Record<string, string>> {
  const pkg = await readPackageJson(projectRoot);
  const scripts = pkg?.scripts ?? {};
  const runPrefix = await detectRunPrefix(projectRoot);
  const commands: Record<string, string> = {};
  for (const { field, scripts: names } of COMMAND_FIELD_SCRIPTS) {
    const name = names.find(
      (candidate) => typeof scripts[candidate] === "string" && scripts[candidate] !== "",
    );
    if (name) commands[field] = `${runPrefix} ${name}`;
  }
  return commands;
}

/** Framework / runtime markers, in priority order, matched against package.json. */
const FRAMEWORK_MARKERS: { dependency: string; name: string }[] = [
  { dependency: "next", name: "Next.js" },
  { dependency: "@remix-run/react", name: "Remix" },
  { dependency: "@nestjs/core", name: "NestJS" },
  { dependency: "@angular/core", name: "Angular" },
  { dependency: "@sveltejs/kit", name: "SvelteKit" },
  { dependency: "svelte", name: "Svelte" },
  { dependency: "nuxt", name: "Nuxt" },
  { dependency: "vue", name: "Vue" },
  { dependency: "astro", name: "Astro" },
  { dependency: "react", name: "React" },
  { dependency: "@nestjs/common", name: "NestJS" },
  { dependency: "fastify", name: "Fastify" },
  { dependency: "express", name: "Express" },
];

/**
 * Infer a human-readable framework string (e.g. "Bun + Nx", "Next.js") from the
 * project's installed files — runtime/monorepo tooling first, then the primary
 * framework dependency. Returns undefined when nothing recognizable is found.
 */
export async function detectFramework(projectRoot: string): Promise<string | undefined> {
  const pkg = await readPackageJson(projectRoot);
  const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const detected: string[] = [];

  if ((await fileExists(projectRoot, "bun.lock")) || (await fileExists(projectRoot, "bun.lockb"))) {
    detected.push("Bun");
  }
  if (await fileExists(projectRoot, "nx.json")) detected.push("Nx");

  for (const { dependency, name } of FRAMEWORK_MARKERS) {
    if (dependencies[dependency] && !detected.includes(name)) {
      detected.push(name);
      break; // one primary framework alongside the runtime/tooling is enough
    }
  }

  return detected.length > 0 ? detected.join(" + ") : undefined;
}

async function gitText(projectRoot: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn({
      cmd: ["git", ...args],
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
  } catch {
    return "";
  }
}

/**
 * Detect the repository's default branch — the one new PRs should target. Reads
 * the `origin/HEAD` symbolic ref first, then falls back to whichever of `main`
 * or `master` exists. Returns undefined outside a git repo or when none match.
 */
export async function detectDefaultBranch(projectRoot: string): Promise<string | undefined> {
  const head = await gitText(projectRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head) {
    const branch = head.replace(/^origin\//, "").trim();
    if (branch) return branch;
  }
  for (const candidate of ["main", "master"]) {
    const verified = await gitText(projectRoot, ["rev-parse", "--verify", "--quiet", candidate]);
    if (verified) return candidate;
  }
  return undefined;
}

/**
 * All wizard field values we can prepopulate from the project: detected
 * commands, framework, and PR base branch. Keyed by wizard field id.
 */
export async function detectInitialValues(projectRoot: string): Promise<Record<string, string>> {
  const values: Record<string, string> = { ...(await detectCommandsFromPackageJson(projectRoot)) };
  const framework = await detectFramework(projectRoot);
  if (framework) values["project.framework"] = framework;
  const defaultBranch = await detectDefaultBranch(projectRoot);
  if (defaultBranch) values["prBaseBranch"] = defaultBranch;
  return values;
}
