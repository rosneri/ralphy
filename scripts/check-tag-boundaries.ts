#!/usr/bin/env bun
/**
 * Tag-driven dependency-boundary guard (RLF-262).
 *
 * Makes the decorative `scope:*` nx tags load-bearing. Each project may depend
 * only on projects of equal or lower rank in the scope DAG (see
 * `workspace-graph.ts` for the ranking). An edge whose target ranks **higher**
 * than its source is an upward violation and fails the build — unless it is on
 * the explicit grandfather allowlist of pre-existing edges.
 *
 * This is a ratcheting guard: it locks today's clean state and blocks only new
 * upward edges. New packages get constrained automatically the moment they
 * declare a `scope:*` tag.
 *
 * Bun-native loader (`workspace-graph.ts`); no node:fs.
 */

import {
  loadWorkspaceGraph,
  rankOf,
  REPO_ROOT,
  scopeOf,
  type WorkspaceNode,
} from "./workspace-graph";

/**
 * Grandfathered upward edges (`from → to` package names) that violate the rank
 * rule but already exist on `main`. This allowlist is the **only** way an upward
 * edge passes. Removing an entry requires removing the underlying dependency.
 */
export const GRANDFATHER_ALLOWLIST: ReadonlyArray<readonly [string, string]> = [
  // `@ralphy/core` (scope:shared, rank 0) depends on `@ralphy/engine`'s
  // (scope:cli, rank 1) run primitives today. Removing this requires moving
  // code out of engine — out of scope for RLF-262.
  ["@ralphy/core", "@ralphy/engine"],
];

export interface BoundaryViolation {
  from: string;
  fromScope: string;
  to: string;
  toScope: string;
}

/**
 * Return every edge whose target rank is strictly greater than its source rank
 * (an upward dependency), excluding edges on the grandfather allowlist. Edges to
 * non-workspace names (not present in the graph) are ignored.
 */
export function findBoundaryViolations(
  graph: WorkspaceNode[],
  allowlist: ReadonlyArray<readonly [string, string]> = GRANDFATHER_ALLOWLIST,
): BoundaryViolation[] {
  const byName = new Map(graph.map((node) => [node.name, node]));
  const allowed = new Set(allowlist.map(([from, to]) => `${from}→${to}`));
  const violations: BoundaryViolation[] = [];

  for (const node of graph) {
    const fromScope = scopeOf(node);
    const fromRank = rankOf(fromScope);
    for (const edge of node.edges) {
      const target = byName.get(edge);
      if (!target) continue;
      const toScope = scopeOf(target);
      if (rankOf(toScope) > fromRank && !allowed.has(`${node.name}→${edge}`)) {
        violations.push({ from: node.name, fromScope, to: edge, toScope });
      }
    }
  }
  return violations;
}

async function reportBoundaryViolations(): Promise<void> {
  const graph = await loadWorkspaceGraph(REPO_ROOT);
  const violations = findBoundaryViolations(graph);

  if (violations.length === 0) {
    console.log("✓ No upward dependency-boundary violations (scope DAG respected)");
    return;
  }

  console.error(`✘ Found ${violations.length} upward dependency-boundary violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.from} (scope:${v.fromScope}) → ${v.to} (scope:${v.toScope})`);
  }
  console.error(
    "\nA project may depend only on projects of equal or lower rank in the scope\n" +
      "DAG (shared < cli < apps < shell). Add a grandfather entry only for\n" +
      "pre-existing edges. See scripts/check-tag-boundaries.ts.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await reportBoundaryViolations();
}
