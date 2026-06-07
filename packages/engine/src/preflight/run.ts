import { checkGhAuth } from "./gh";
import { checkClaudeAuth } from "./claude";
import { checkRepoWriteAccess } from "./repo";
import type { PreflightResult } from "./types";

export interface PreflightOptions {
  /** When true, also verify the active credential can push to the GitHub repo
   *  resolved from {@link PreflightOptions.repoCwd}. Callers set this when the
   *  run will create PRs — an unauthorized repo then halts the agent up front
   *  instead of after a wasted worker run. */
  requireRepoWrite?: boolean;
  /** Working dir whose git remote gh resolves for the repo-write check. */
  repoCwd?: string;
}

export async function runPreflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const gh = await checkGhAuth();
  if (!gh.ok) return gh;
  const claude = await checkClaudeAuth();
  if (!claude.ok) return claude;
  if (opts.requireRepoWrite && opts.repoCwd) {
    const repo = await checkRepoWriteAccess(opts.repoCwd);
    if (!repo.ok) return repo;
  }
  return { ok: true };
}
