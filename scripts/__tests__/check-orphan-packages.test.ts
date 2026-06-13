import { describe, expect, test } from "bun:test";
import { findOrphanPackages } from "../check-orphan-packages";
import { loadWorkspaceGraph, type WorkspaceNode } from "../workspace-graph";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function pkg(name: string, edges: string[] = []): WorkspaceNode {
  return { name, dir: `packages/${name.replace("@ralphy/", "")}`, scope: "shared", edges };
}

function app(name: string, edges: string[] = []): WorkspaceNode {
  return { name, dir: `apps/${name.replace("@ralphy/", "")}`, scope: "agent", edges };
}

describe("findOrphanPackages", () => {
  test("flags a non-app package with zero inbound edges", () => {
    const graph: WorkspaceNode[] = [
      app("@ralphy/consumer", ["@ralphy/used"]),
      pkg("@ralphy/used"),
      pkg("@ralphy/orphan"),
    ];
    const orphans = findOrphanPackages(graph, []);
    expect(orphans.map((n) => n.name)).toEqual(["@ralphy/orphan"]);
  });

  test("allowlist suppresses an orphan", () => {
    const graph: WorkspaceNode[] = [pkg("@ralphy/orphan")];
    expect(findOrphanPackages(graph, ["@ralphy/orphan"])).toEqual([]);
  });

  test("apps are exempt even with zero inbound edges", () => {
    const graph: WorkspaceNode[] = [app("@ralphy/shell", ["@ralphy/lib"]), pkg("@ralphy/lib")];
    expect(findOrphanPackages(graph, [])).toEqual([]);
  });

  test("devDependency edges count as inbound", () => {
    // loadWorkspaceGraph merges deps + devDeps into `edges`, so a dev-only
    // dependency appears as a normal inbound edge here.
    const graph: WorkspaceNode[] = [
      app("@ralphy/consumer", ["@ralphy/dev-only"]),
      pkg("@ralphy/dev-only"),
    ];
    expect(findOrphanPackages(graph, [])).toEqual([]);
  });
});

describe("loadWorkspaceGraph (integration over the real tree)", () => {
  test("loads packages + apps and core depends on engine", async () => {
    const graph = await loadWorkspaceGraph(REPO_ROOT);
    expect(graph.length).toBeGreaterThan(20);

    const core = graph.find((n) => n.name === "@ralphy/core");
    expect(core).toBeDefined();
    expect(core?.scope).toBe("shared");
    expect(core?.edges).toContain("@ralphy/engine");

    const engine = graph.find((n) => n.name === "@ralphy/engine");
    expect(engine?.scope).toBe("cli");

    // ui-shared has no project.json → defaults to shared.
    const uiShared = graph.find((n) => n.name === "@ralphy/ui-shared");
    expect(uiShared?.scope).toBe("shared");
  });
});
