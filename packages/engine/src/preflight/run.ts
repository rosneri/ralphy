import { checkGhAuth } from "./gh";
import { checkClaudeAuth } from "./claude";
import { checkRepoWriteAccess } from "./repo";
import { checkTokenade } from "./tokenade";
import type { PreflightResult } from "./types";

export interface PreflightOptions {
  /** When true, also verify the active credential can push to the GitHub repo
   *  resolved from {@link PreflightOptions.repoCwd}. Callers set this when the
   *  run will create PRs — an unauthorized repo then halts the agent up front
   *  instead of after a wasted worker run. */
  requireRepoWrite?: boolean;
  /** Working dir whose git remote gh resolves for the repo-write check. */
  repoCwd?: string;
  /** The resolved `tokenade` block. Omitted (or `enabled: false`) skips the
   *  probe entirely. When `required` is false — the default — a Tokenade that
   *  is missing or unlicensed reports through {@link PreflightOptions.onWarning}
   *  and the run proceeds unoptimized; `required: true` promotes it to a
   *  halting failure like the gh / claude checks. */
  tokenade?: { enabled: boolean; required: boolean };
  /** Non-fatal preflight findings. Called at most once per check that degraded
   *  instead of failing; callers surface these to the operator. */
  onWarning?: (message: string) => void;
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
  // Last, and the only check that can degrade rather than halt: an unoptimized
  // run is still a correct run.
  if (opts.tokenade?.enabled) {
    const tokenade = await checkTokenade();
    if (!tokenade.ok) {
      if (opts.tokenade.required) return tokenade;
      opts.onWarning?.(tokenade.message);
    }
  }
  return { ok: true };
}
