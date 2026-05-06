import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { seedWorktreeMcpConfig } from "../agent/wire";

let projectRoot: string;
let worktree: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "wire-mcp-"));
  projectRoot = join(root, "proj");
  worktree = join(root, "wt");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(worktree, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(worktree, { recursive: true, force: true });
});

const sampleConfig = (relPath: string) => ({
  mcpServers: {
    ralphy: {
      command: "bun",
      args: [relPath, "--flag", 42, true],
    },
    other: {
      command: "node",
      args: ["/already/absolute/path.js", "lib/foo.js"],
    },
  },
});

describe("seedWorktreeMcpConfig (§1 manual plan)", () => {
  test("§1.1 copies project .mcp.json into worktree", async () => {
    const src = join(projectRoot, ".mcp.json");
    writeFileSync(src, JSON.stringify(sampleConfig(".ralph/bin/mcp.js")));

    await seedWorktreeMcpConfig(projectRoot, worktree);

    const dst = join(worktree, ".mcp.json");
    expect(existsSync(dst)).toBe(true);
  });

  test("§1.2 rewrites .ralph/ relative args to absolute paths under projectRoot", async () => {
    const src = join(projectRoot, ".mcp.json");
    writeFileSync(src, JSON.stringify(sampleConfig(".ralph/bin/mcp.js")));

    await seedWorktreeMcpConfig(projectRoot, worktree);

    const result = JSON.parse(readFileSync(join(worktree, ".mcp.json"), "utf8"));
    // Rewritten to absolute path under projectRoot
    expect(result.mcpServers.ralphy.args[0]).toBe(join(projectRoot, ".ralph/bin/mcp.js"));
    // Non-string args preserved as-is
    expect(result.mcpServers.ralphy.args[1]).toBe("--flag");
    expect(result.mcpServers.ralphy.args[2]).toBe(42);
    expect(result.mcpServers.ralphy.args[3]).toBe(true);
    // Already-absolute paths untouched
    expect(result.mcpServers.other.args[0]).toBe("/already/absolute/path.js");
    // Non-.ralph relative paths untouched (only .ralph/ is rewritten)
    expect(result.mcpServers.other.args[1]).toBe("lib/foo.js");
  });

  test("§1.3 no-op when neither project nor worktree has .mcp.json", async () => {
    await seedWorktreeMcpConfig(projectRoot, worktree);
    expect(existsSync(join(worktree, ".mcp.json"))).toBe(false);
  });

  test("§1.4 worktree's existing .mcp.json takes precedence over project's", async () => {
    // Both exist, but worktree copy should win as the source-of-truth.
    writeFileSync(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { fromProject: { command: "p", args: [] } } }),
    );
    writeFileSync(
      join(worktree, ".mcp.json"),
      JSON.stringify({ mcpServers: { fromWorktree: { command: "w", args: [] } } }),
    );

    await seedWorktreeMcpConfig(projectRoot, worktree);

    const result = JSON.parse(readFileSync(join(worktree, ".mcp.json"), "utf8"));
    expect(result.mcpServers).toHaveProperty("fromWorktree");
    expect(result.mcpServers).not.toHaveProperty("fromProject");
  });

  test("§1.4 worktree .mcp.json with already-absolute paths is unchanged after seeding", async () => {
    const original = JSON.stringify(
      {
        mcpServers: {
          ralphy: { command: "bun", args: ["/abs/path/mcp.js"] },
        },
      },
      null,
      2,
    );
    writeFileSync(join(worktree, ".mcp.json"), original);

    await seedWorktreeMcpConfig(projectRoot, worktree);

    const result = JSON.parse(readFileSync(join(worktree, ".mcp.json"), "utf8"));
    expect(result.mcpServers.ralphy.args[0]).toBe("/abs/path/mcp.js");
  });

  test("§1.5 invalid JSON is skipped without throwing (graceful degradation)", async () => {
    writeFileSync(join(projectRoot, ".mcp.json"), "{ this is not json");

    // Must not throw — caller (wire.ts) catches but this guards the inner contract.
    await seedWorktreeMcpConfig(projectRoot, worktree);

    // No file written to worktree
    expect(existsSync(join(worktree, ".mcp.json"))).toBe(false);
  });

  test("config without mcpServers map is written through unchanged", async () => {
    writeFileSync(join(projectRoot, ".mcp.json"), JSON.stringify({ other: "field" }));

    await seedWorktreeMcpConfig(projectRoot, worktree);

    const result = JSON.parse(readFileSync(join(worktree, ".mcp.json"), "utf8"));
    expect(result).toEqual({ other: "field" });
  });

  test("server entry without args array is left intact", async () => {
    writeFileSync(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { x: { command: "y" } } }),
    );

    await seedWorktreeMcpConfig(projectRoot, worktree);

    const result = JSON.parse(readFileSync(join(worktree, ".mcp.json"), "utf8"));
    expect(result.mcpServers.x).toEqual({ command: "y" });
  });
});
