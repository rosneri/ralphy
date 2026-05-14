import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Injected at build time by the shell app's build.ts via Bun.build define.
// Falls back to a runtime walk when executing from source.
declare const RALPH_VERSION: string | undefined;

export function getVersion(): string {
  try {
    if (typeof RALPH_VERSION !== "undefined" && RALPH_VERSION) return RALPH_VERSION;
  } catch {
    // not defined in this context
  }

  const dirsToTry: string[] = [];
  try {
    dirsToTry.push(import.meta.dir);
  } catch {
    // import.meta.dir might not be available
  }
  dirsToTry.push(process.cwd());

  for (const startDir of dirsToTry) {
    let current = startDir;
    for (let i = 0; i < 10; i++) {
      const pkgPath = resolve(current, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces && pkg.version && pkg.version !== "0.0.0") {
          return pkg.version;
        }
      } catch {
        // keep walking
      }
      const parent = resolve(current, "..");
      if (parent === current) break;
      current = parent;
    }
  }

  return "unknown";
}

export const VERSION: string = getVersion();
