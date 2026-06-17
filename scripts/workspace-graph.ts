#!/usr/bin/env bun
/**
 * Shared workspace-graph loader (RLF-262).
 *
 * Enumerates every project under `packages/*` and `apps/*`, reading the
 * `scope:*` tag from each `project.json` (the single source of truth for the
 * dependency-boundary DAG) and the `@ralphy/*` workspace edges from each
 * `package.json` (merged `dependencies` + `devDependencies`). The resulting
 * `WorkspaceNode[]` feeds both the tag-driven boundary guard
 * (`check-tag-boundaries.ts`) and the whole-package-orphan detector
 * (`check-orphan-packages.ts`).
 *
 * Bun-native: enumerates with `Bun.Glob`, reads with `Bun.file`. No node:fs.
 */

import { join } from "node:path";

/** Repo root, shared by the check scripts that consume the graph. */
export const REPO_ROOT = join(import.meta.dirname, "..");

/** A single workspace project (one `packages/*` or `apps/*` directory). */
export interface WorkspaceNode {
  /** Package name from `package.json`, e.g. `@ralphy/core`. */
  name: string;
  /** Repo-relative directory, normalized to `/`, e.g. `packages/core`. */
  dir: string;
  /** `scope:*` tag value (without the `scope:` prefix); `"shared"` if untagged. */
  scope: string;
  /** `@ralphy/*` workspace dependency names (deps + devDeps), sorted, deduped. */
  edges: string[];
}

/**
 * Rank of each scope in the layering DAG, low → high. A project may depend only
 * on projects of **equal or lower** rank.
 *
 * - 0 `shared` (and untagged, e.g. `ui-shared`): leaf libraries.
 * - 1 `cli`: `engine`, `adapter-codex`.
 * - 2 leaf apps (`agent`, `init`, `loop`, `mcp`, `ui`).
 * - 3 `shell`: composition root; may import the leaf apps.
 */
const SCOPE_RANK: Record<string, number> = {
  shared: 0,
  cli: 1,
  agent: 2,
  init: 2,
  loop: 2,
  mcp: 2,
  ui: 2,
  shell: 3,
};

/** Scope of a node, defaulting untagged projects (e.g. `ui-shared`) to `shared`. */
export function scopeOf(node: WorkspaceNode): string {
  return node.scope || "shared";
}

/** Rank of a scope; unknown scopes are treated as `shared` (rank 0). */
export function rankOf(scope: string): number {
  return SCOPE_RANK[scope] ?? 0;
}

/** Extract the `scope:*` tag (sans prefix) from a parsed `project.json`. */
function tagScope(projectJson: unknown): string {
  const tags = (projectJson as { tags?: unknown })?.tags;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === "string" && tag.startsWith("scope:")) {
        return tag.slice("scope:".length);
      }
    }
  }
  return "shared";
}

/** Merge `dependencies` + `devDependencies` and keep only `@ralphy/*` names. */
function ralphyEdges(packageJson: unknown): string[] {
  const pkg = packageJson as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = new Set<string>();
  for (const deps of [pkg?.dependencies, pkg?.devDependencies]) {
    for (const name of Object.keys(deps ?? {})) {
      if (name.startsWith("@ralphy/")) names.add(name);
    }
  }
  return [...names].sort();
}

/** Read+parse a JSON file, returning `null` if it does not exist. */
async function readJson(path: string): Promise<unknown | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return file.json();
}

/**
 * Load the workspace graph rooted at `root`. Enumerates `packages/*` and
 * `apps/*`, reading each project's tag and `@ralphy/*` edges. Directories
 * without a `package.json` are skipped (they are not workspace members).
 */
export async function loadWorkspaceGraph(root: string): Promise<WorkspaceNode[]> {
  const nodes: WorkspaceNode[] = [];
  const glob = new Bun.Glob("{packages,apps}/*/package.json");
  for await (const rel of glob.scan({ cwd: root })) {
    const pkgRel = rel.replaceAll("\\", "/");
    const dir = pkgRel.slice(0, pkgRel.lastIndexOf("/"));
    const packageJson = (await readJson(join(root, pkgRel))) as { name?: string } | null;
    if (!packageJson?.name) continue;
    const projectJson = await readJson(join(root, dir, "project.json"));
    nodes.push({
      name: packageJson.name,
      dir,
      scope: tagScope(projectJson),
      edges: ralphyEdges(packageJson),
    });
  }
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}
