import { spawn } from "../spawn";
import { scrubGithubAppTokenEnv } from "./env";
import type { PreflightResult } from "./types";

export const REPO_WRITE_FAIL_MESSAGE =
  "No write access to this repository — the active credential can read it but cannot " +
  "push, so every issue would fail at PR creation (and be re-queued). Ralphy uses gh's " +
  "auth for all GitHub operations: grant push access to `GH_TOKEN` (or `gh auth login`), " +
  "or, if you rely on a fine-grained PAT, give it Contents: write + Pull requests: write " +
  "+ Commit statuses: read. Then restart the agent.";

const PROBE_REF = "refs/heads/ralphy-preflight-write-probe";
/** An all-zero sha is never a real object, so this create-ref call CANNOT
 *  succeed — it only reveals whether the credential is *allowed* to write. */
const ZERO_SHA = "0000000000000000000000000000000000000000";

/** Token HAS write: the create-ref got past the permission gate and failed
 *  only on the invalid sha (422 Unprocessable / "Object does not exist"). */
const HAS_WRITE_RE = /"status":\s*"422"|Object does not exist|Unprocessable/i;
/** Token CANNOT write: rejected at the permission gate (403 not accessible /
 *  "Write access ... not granted"), before payload validation. */
const NO_WRITE_RE =
  /"status":\s*"403"|not accessible by personal access token|Write access to repository not granted/i;

/**
 * Verify the active gh credential can actually push to the GitHub repo resolved
 * from `cwd`'s git remote. Used as a preflight gate so an unauthorized repo
 * halts the agent up front rather than after a wasted worker run.
 *
 * Probes the token's real Contents:write capability via a create-ref call with
 * an invalid (all-zero) sha — which never mutates the repo: a writable token is
 * rejected only on the bad sha (422), a read-only token is rejected first at the
 * permission gate (403). A role-based check (`gh repo view viewerPermission`) is
 * NOT enough — it reports ADMIN for a fine-grained PAT scoped to contents:read.
 *
 * `{owner}/{repo}` are gh placeholders resolved from the cwd remote (no slug
 * parsing). The env is scrubbed of `GITHUB_TOKEN` so this checks the SAME
 * credential the scrubbed git/gh runners will push with. Ambiguous outcomes
 * (repo not found, network) do not halt — the real push surfaces those.
 */
export async function checkRepoWriteAccess(cwd: string): Promise<PreflightResult> {
  let blob = "";
  try {
    const proc = spawn({
      cmd: [
        "gh",
        "api",
        "-X",
        "POST",
        "repos/{owner}/{repo}/git/refs",
        "-f",
        `ref=${PROBE_REF}`,
        "-f",
        `sha=${ZERO_SHA}`,
      ],
      cwd,
      env: scrubGithubAppTokenEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
    await proc.exited;
    blob = `${stdout}\n${stderr}`;
  } catch {
    // Never block on a probe crash (e.g. gh missing) — gh-auth preflight covers that.
    return { ok: true };
  }
  if (HAS_WRITE_RE.test(blob)) return { ok: true };
  if (NO_WRITE_RE.test(blob)) return { ok: false, tool: "repo", message: REPO_WRITE_FAIL_MESSAGE };
  return { ok: true };
}
