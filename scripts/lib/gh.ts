/**
 * Minimal standalone `gh` CLI helper for repo scripts (RLF-261).
 *
 * Deliberately separate from `apps/agent`'s gh capability (which is coupled to
 * the agent's capability shell / retry bus): these are plain one-shot
 * invocations for maintainer-run branch-protection scripts.
 *
 * Bun-native: uses `Bun.spawn`, no `node:child_process`.
 */

interface GhInvocation {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a single `gh` command, optionally piping `stdin`, and capture its output. */
export async function runGh(args: string[], stdin?: string): Promise<GhInvocation> {
  const proc = Bun.spawn(["gh", ...args], {
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin);
    await proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Resolve the current repo as `{owner}/{repo}` via `gh repo view`. */
export async function resolveRepoSlug(): Promise<string> {
  const result = await runGh(["repo", "view", "--json", "nameWithOwner"]);
  if (result.code !== 0) {
    throw new Error(`gh repo view failed: ${result.stderr || result.stdout}`);
  }
  const { nameWithOwner } = JSON.parse(result.stdout) as { nameWithOwner: string };
  if (!nameWithOwner) {
    throw new Error("Could not derive {owner}/{repo} from `gh repo view`.");
  }
  return nameWithOwner;
}
