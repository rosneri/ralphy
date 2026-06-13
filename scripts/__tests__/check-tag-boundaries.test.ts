import { describe, expect, test } from "bun:test";
import { findBoundaryViolations } from "../check-tag-boundaries";
import type { WorkspaceNode } from "../workspace-graph";

function node(name: string, scope: string, edges: string[] = []): WorkspaceNode {
  return { name, dir: `packages/${name}`, scope, edges };
}

describe("findBoundaryViolations", () => {
  test("clean graph (only downward/equal edges) passes", () => {
    const graph: WorkspaceNode[] = [
      node("@ralphy/types", "shared"),
      node("@ralphy/engine", "cli", ["@ralphy/types"]),
      { name: "@ralphy/agent", dir: "apps/agent", scope: "agent", edges: ["@ralphy/engine"] },
    ];
    expect(findBoundaryViolations(graph, [])).toEqual([]);
  });

  test("forbidden upward edge (shared → cli) fails", () => {
    const graph: WorkspaceNode[] = [
      node("@ralphy/core", "shared", ["@ralphy/engine"]),
      node("@ralphy/engine", "cli"),
    ];
    const violations = findBoundaryViolations(graph, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      from: "@ralphy/core",
      fromScope: "shared",
      to: "@ralphy/engine",
      toScope: "cli",
    });
  });

  test("grandfathered-only graph passes", () => {
    const graph: WorkspaceNode[] = [
      node("@ralphy/core", "shared", ["@ralphy/engine"]),
      node("@ralphy/engine", "cli"),
    ];
    expect(findBoundaryViolations(graph, [["@ralphy/core", "@ralphy/engine"]])).toEqual([]);
  });

  test("shell → app is allowed (rank 3 may import rank 2)", () => {
    const graph: WorkspaceNode[] = [
      { name: "@ralphy/shell", dir: "apps/shell", scope: "shell", edges: ["@ralphy/agent"] },
      { name: "@ralphy/agent", dir: "apps/agent", scope: "agent", edges: [] },
    ];
    expect(findBoundaryViolations(graph, [])).toEqual([]);
  });

  test("app → app (non-shell) is rejected", () => {
    const graph: WorkspaceNode[] = [
      { name: "@ralphy/agent", dir: "apps/agent", scope: "agent", edges: ["@ralphy/loop"] },
      { name: "@ralphy/loop", dir: "apps/loop", scope: "loop", edges: [] },
    ];
    // agent and loop are both rank 2 → equal rank → allowed by rank rule.
    expect(findBoundaryViolations(graph, [])).toEqual([]);
  });

  test("leaf app → shell (rank 2 → rank 3) is rejected", () => {
    const graph: WorkspaceNode[] = [
      { name: "@ralphy/agent", dir: "apps/agent", scope: "agent", edges: ["@ralphy/shell"] },
      { name: "@ralphy/shell", dir: "apps/shell", scope: "shell", edges: [] },
    ];
    const violations = findBoundaryViolations(graph, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ from: "@ralphy/agent", to: "@ralphy/shell" });
  });

  test("edges to non-workspace names are ignored", () => {
    const graph: WorkspaceNode[] = [node("@ralphy/core", "shared", ["@ralphy/nonexistent"])];
    expect(findBoundaryViolations(graph, [])).toEqual([]);
  });
});
