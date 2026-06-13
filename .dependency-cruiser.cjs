/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "mcp-no-engine",
      severity: "error",
      comment: "MCP app must not import the engine package (scope:cli only)",
      from: { path: "^apps/mcp" },
      to: { path: "^packages/engine" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies allowed",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment: "Modules should be reachable from an entry point",
      from: {
        orphan: true,
        // Dotfiles, ambient .d.ts, and test files are never orphan candidates.
        // Append known-dead production modules here as a grandfather allowlist
        // (empty today — depcruise reports zero file orphans on `main`).
        pathNot: ["(^|/)\\.[^/]+", "\\.d\\.ts$", "\\.test\\.ts$", "\\.spec\\.ts$"],
      },
      to: {},
    },
    {
      name: "github-client-confinement",
      severity: "error",
      comment: "github-client.ts may only be imported from its owning github/ dir",
      from: {
        // The co-located unit test lives outside github/ (in
        // capabilities/__tests__/) and depcruise scans apps/*/src with no global
        // test exclusion, so the test carve-out is required to avoid a false fail.
        pathNot: [
          "^apps/agent/src/shared/capabilities/github/",
          "\\.test\\.ts$",
          "\\.spec\\.ts$",
        ],
      },
      to: { path: "^apps/agent/src/shared/capabilities/github/github-client\\.ts$" },
    },
    {
      name: "no-test-imports-in-prod",
      severity: "error",
      comment: "Production code should not import test files",
      from: {
        pathNot: "\\.test\\.ts$|\\.spec\\.ts$",
      },
      to: {
        path: "\\.test\\.ts$|\\.spec\\.ts$",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
  },
};
