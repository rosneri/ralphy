#!/usr/bin/env bun
/**
 * Whole-package-orphan detector (RLF-262).
 *
 * dependency-cruiser's `no-orphans` rule catches orphaned *files* but is blind
 * to a whole *package* that nothing imports. This guard flags any non-app
 * workspace package with zero inbound `@ralphy/*` edges (across all projects'
 * merged deps + devDeps), minus an explicit allowlist.
 *
 * Apps (`apps/*`) are exempt: they are entry points with no inbound edges by
 * design (`shell`, `ui`, `mcp`, …), so they would always falsely flag.
 *
 * Bun-native loader (`workspace-graph.ts`); no node:fs.
 */

import { loadWorkspaceGraph, REPO_ROOT, type WorkspaceNode } from "./workspace-graph";

/**
 * Packages allowed to have zero inbound edges. The single seed is a package
 * that is published/consumed out-of-tree rather than via a workspace edge.
 */
export const ORPHAN_ALLOWLIST: ReadonlyArray<string> = [
  // Consumed by external agent processes, not via a workspace edge yet.
  // Remove once #413 lands and wires it into the in-tree graph.
  "@ralphy/agent-protocol",
];

/**
 * Return every non-app workspace package with zero inbound `@ralphy/*` edges,
 * excluding allowlisted names. A package is an "app" iff its `dir` is under
 * `apps/`.
 */
export function findOrphanPackages(
  graph: WorkspaceNode[],
  allowlist: ReadonlyArray<string> = ORPHAN_ALLOWLIST,
): WorkspaceNode[] {
  const allowed = new Set(allowlist);
  const inbound = new Set<string>();
  for (const node of graph) {
    for (const edge of node.edges) inbound.add(edge);
  }

  return graph.filter(
    (node) => !node.dir.startsWith("apps/") && !inbound.has(node.name) && !allowed.has(node.name),
  );
}

async function reportOrphanPackages(): Promise<void> {
  const graph = await loadWorkspaceGraph(REPO_ROOT);
  const orphans = findOrphanPackages(graph);

  if (orphans.length === 0) {
    console.log("✓ No orphaned workspace packages (every package has an inbound edge)");
    return;
  }

  console.error(`✘ Found ${orphans.length} orphaned workspace package(s):\n`);
  for (const node of orphans) {
    console.error(`  ${node.name} (${node.dir}) — no @ralphy/* package depends on it`);
  }
  console.error(
    "\nEvery non-app package must have at least one inbound workspace edge. Either\n" +
      "wire it into a consumer, delete it, or add it to the allowlist with a reason.\n" +
      "See scripts/check-orphan-packages.ts.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await reportOrphanPackages();
}
