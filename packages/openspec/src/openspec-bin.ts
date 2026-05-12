import { dirname, join } from "node:path";

export interface InstallRunner {
  spawnSync: (cmd: string[], cwd: string) => { exitCode: number | null };
  resolveSync: (specifier: string, fromDir: string) => string;
  log: (text: string) => void;
}

const bunInstallRunner: InstallRunner = {
  spawnSync: (cmd, cwd) => {
    const proc = Bun.spawnSync({
      cmd,
      cwd,
      stdio: ["ignore", "inherit", "inherit"],
    });
    return { exitCode: proc.exitCode };
  },
  resolveSync: (specifier, fromDir) => Bun.resolveSync(specifier, fromDir),
  log: (text) => {
    process.stderr.write(text);
  },
};

/**
 * Walk up from a starting directory until a directory containing `package.json`
 * is found. Used to discover ralphy's install root from a bundled file at
 * e.g. `<install>/dist/cli/index.js`.
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (Bun.file(join(dir, "package.json")).size >= 0) {
      try {
        if (Bun.file(join(dir, "package.json")).size > 0) return dir;
      } catch {
        // fall through
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

/**
 * Best-effort install of `@fission-ai/openspec` into ralphy's own
 * install directory so the next `resolveSync` finds it. Tries `npm install`
 * first (works for both `npm i -g` and per-project installs), then `bun add`.
 *
 * Exported for tests; production callers should use {@link resolveOpenspecBin}.
 */
export function ensureOpenspecInstalled(fromDir: string, runner: InstallRunner): void {
  const installDir = findPackageRoot(fromDir);
  runner.log(
    `[ralphy] @fission-ai/openspec not found in ${installDir} — installing automatically...\n`,
  );
  const candidates: string[][] = [
    ["npm", "install", "--no-save", "--no-audit", "--no-fund", "@fission-ai/openspec@latest"],
    ["bun", "add", "@fission-ai/openspec@latest"],
  ];
  for (const cmd of candidates) {
    try {
      const result = runner.spawnSync(cmd, installDir);
      if (result.exitCode === 0) {
        runner.log(`[ralphy] installed @fission-ai/openspec via ${cmd[0]}.\n`);
        return;
      }
    } catch {
      // try next candidate
    }
  }
  const err = new Error("openspec auto-install failed") as Error & { installDir?: string };
  err.installDir = installDir;
  throw err;
}

/**
 * Resolve the absolute path to the bundled `@fission-ai/openspec` CLI script.
 * If the package is missing at runtime (typical when an older ralphy install
 * didn't declare it as a runtime dependency), auto-install it once and retry.
 */
export function resolveOpenspecBin(
  fromDir: string,
  runner: InstallRunner = bunInstallRunner,
): string {
  try {
    const pkgJsonPath = runner.resolveSync("@fission-ai/openspec/package.json", fromDir);
    return join(dirname(pkgJsonPath), "bin", "openspec.js");
  } catch {
    ensureOpenspecInstalled(fromDir, runner);
    const pkgJsonPath = runner.resolveSync("@fission-ai/openspec/package.json", fromDir);
    return join(dirname(pkgJsonPath), "bin", "openspec.js");
  }
}
