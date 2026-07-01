import { join } from "node:path";

/**
 * Seed the worktree's `.mcp.json` so engines spawned inside the worktree see
 * the ralphy MCP server. `.ralph/bin/mcp.js` is gitignored, so any relative
 * `.ralph/...` arg in the worktree's `.mcp.json` won't resolve from inside
 * the worktree.
 *
 * Read whichever `.mcp.json` is available (preferring the worktree's own
 * checked-in copy, falling back to the project root's), rewrite any
 * relative `.ralph/...` args to absolute paths under `projectRoot`, and
 * write the result into the worktree. No-op if neither exists.
 */
export async function seedWorktreeMcpConfig(
  projectRoot: string,
  worktreeCwd: string,
): Promise<void> {
  const dst = join(worktreeCwd, ".mcp.json");
  const src = join(projectRoot, ".mcp.json");
  const source = (await Bun.file(dst).exists()) ? dst : (await Bun.file(src).exists()) ? src : null;
  if (!source) return;
  let parsed: { mcpServers?: Record<string, { args?: unknown[] }> };
  try {
    parsed = await Bun.file(source).json();
  } catch {
    return;
  }
  const servers = parsed.mcpServers;
  if (servers && typeof servers === "object") {
    // ponytail: RALPHY_MCP_SERVERS (comma-separated server-name allowlist) trims the
    // seeded set so loop engines don't inherit every dev MCP server. A dozen servers'
    // tool schemas balloon the per-turn baseline context (~760K tokens observed) and
    // send autocompact into a thrash loop. Unset = seed all (backward compat).
    const allow = Bun.env.RALPHY_MCP_SERVERS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allow?.length) {
      for (const key of Object.keys(servers)) {
        if (!allow.includes(key)) delete servers[key];
      }
    }
    for (const serverConfig of Object.values(servers)) {
      if (Array.isArray(serverConfig.args)) {
        serverConfig.args = serverConfig.args.map((a) =>
          typeof a === "string" && a.startsWith(".ralph/") ? join(projectRoot, a) : a,
        );
      }
    }
  }
  await Bun.write(dst, JSON.stringify(parsed, null, 2) + "\n");
}
