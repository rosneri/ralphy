import { spawn } from "../spawn";
import type { PreflightResult } from "./types";

export const REPO_WRITE_FAIL_MESSAGE =
  "No write access to this repository — the agent can read it but cannot push, so " +
  "every issue would fail at PR creation (and be re-queued). Grant the active " +
  "credential push access — run `gh auth login` with an account that can push, or set " +
  "`GH_TOKEN` to a token with the `repo` scope (a fine-grained PAT needs Contents + " +
  "Pull requests: write) — then restart the agent.";

/** Viewer permissions that allow pushing. `gh repo view --json viewerPermission`
 *  returns one of ADMIN/MAINTAIN/WRITE/TRIAGE/READ/NONE. */
const WRITE_PERMS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

/**
 * Verify the active gh credential can push to the GitHub repo resolved from
 * `cwd`'s git remote. Used as a preflight gate so an unauthorized repo halts the
 * agent up front rather than after a full (and ultimately wasted) worker run.
 *
 * `gh repo view` lets gh resolve the repo from the cwd remote — no slug parsing
 * — and reports the viewer's permission with the SAME credential `git push`
 * uses (gh's credential helper / `GH_TOKEN`). A non-zero exit (token cannot
 * access the repo at all) is treated as unauthorized.
 */
export async function checkRepoWriteAccess(cwd: string): Promise<PreflightResult> {
  try {
    const proc = spawn({
      cmd: ["gh", "repo", "view", "--json", "viewerPermission", "--jq", ".viewerPermission"],
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    const exit = await proc.exited;
    if (exit !== 0) {
      return { ok: false, tool: "repo", message: REPO_WRITE_FAIL_MESSAGE };
    }
    if (WRITE_PERMS.has(stdout.trim().toUpperCase())) {
      return { ok: true };
    }
    return { ok: false, tool: "repo", message: REPO_WRITE_FAIL_MESSAGE };
  } catch {
    return { ok: false, tool: "repo", message: REPO_WRITE_FAIL_MESSAGE };
  }
}
