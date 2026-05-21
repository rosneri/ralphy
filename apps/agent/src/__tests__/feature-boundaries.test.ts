import { describe, expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";
import { Glob } from "bun";

/**
 * Cross-feature imports are forbidden. A file under
 * `apps/agent/src/features/<a>/**` may only reach into a sibling
 * `features/<b>/**` (where `b !== a`) via the shared seam:
 *   - `features/types.ts`
 *   - `features/run-feature.ts`
 *   - `features/registry.ts` (the dispatch table itself)
 *
 * Everything else under another feature's subtree is off-limits — slices
 * must stay independently shippable. This test scans every `.ts` / `.tsx`
 * file under `features/` and resolves its relative imports; any import
 * that lands inside a sibling feature's directory fails the test.
 */

const FEATURES_ROOT = resolve(import.meta.dir, "..", "features");

const SHARED_SEAM_FILES = new Set(["types", "run-feature", "registry"]);

interface Violation {
  file: string;
  importPath: string;
  resolvedTo: string;
  ownFeature: string;
  siblingFeature: string;
}

function extractRelativeImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    // import ... from "..."
    /\bimport\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g,
    // import("...")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    // export ... from "..."
    /\bexport\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g,
    // require("...")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (spec.startsWith(".")) specifiers.push(spec);
    }
  }
  return specifiers;
}

/** Returns the feature directory name for a file path under FEATURES_ROOT, or null if at root. */
function featureFor(absPath: string): string | null {
  const rel = relative(FEATURES_ROOT, absPath);
  if (rel.startsWith("..")) return null;
  const segments = rel.split(/[\\/]+/);
  // Files directly under features/ (types.ts, run-feature.ts, registry.ts) have one segment.
  if (segments.length < 2) return null;
  return segments[0];
}

describe("feature directory boundaries", () => {
  test("no feature imports from a sibling feature subtree", async () => {
    const violations: Violation[] = [];

    const glob = new Glob("**/*.{ts,tsx}");
    for await (const rel of glob.scan({ cwd: FEATURES_ROOT, absolute: false })) {
      const abs = resolve(FEATURES_ROOT, rel);
      const ownFeature = featureFor(abs);
      if (ownFeature === null) continue; // shared seam file at features root
      const source = await Bun.file(abs).text();
      const imports = extractRelativeImports(source);
      for (const spec of imports) {
        // Strip an optional ".ts"/".tsx"/"/index" tail for stable comparison.
        const resolved = resolve(dirname(abs), spec);
        const targetFeature = featureFor(resolved);
        // Target file under features root itself (e.g. ../types) is allowed.
        if (targetFeature === null) {
          // Verify it's either the shared seam or an entirely-outside-features path.
          const relFromRoot = relative(FEATURES_ROOT, resolved);
          if (!relFromRoot.startsWith("..")) {
            // Inside features root but no feature dir → shared seam file.
            const base = relFromRoot.replace(/\.(ts|tsx)$/, "").replace(/\/index$/, "");
            if (!SHARED_SEAM_FILES.has(base)) {
              violations.push({
                file: rel,
                importPath: spec,
                resolvedTo: relFromRoot,
                ownFeature,
                siblingFeature: "<features root>",
              });
            }
          }
          continue;
        }
        if (targetFeature !== ownFeature) {
          violations.push({
            file: rel,
            importPath: spec,
            resolvedTo: relative(FEATURES_ROOT, resolved),
            ownFeature,
            siblingFeature: targetFeature,
          });
        }
      }
    }

    if (violations.length > 0) {
      const lines = violations.map(
        (v) =>
          `  features/${v.ownFeature}/${v.file} imports "${v.importPath}" → features/${v.resolvedTo} (sibling feature "${v.siblingFeature}")`,
      );
      throw new Error(
        `Cross-feature imports are forbidden. Route via features/types.ts or features/run-feature.ts.\n${lines.join("\n")}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
