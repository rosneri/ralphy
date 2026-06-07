import { spawn } from "../spawn";
import { scrubGithubAppTokenEnv } from "./env";
import type { PreflightResult } from "./types";

export const GH_AUTH_FAIL_MESSAGE =
  "gh is not authenticated. Run `gh auth login` (or set GH_TOKEN), then restart the agent.";

export async function checkGhAuth(): Promise<PreflightResult> {
  try {
    const proc = spawn({
      cmd: ["gh", "auth", "status"],
      // Scrub GITHUB_TOKEN so this validates the SAME credential the scrubbed
      // git/gh runners will use (gh's GH_TOKEN / keyring login), not a stray
      // app-level token that would otherwise shadow it.
      env: scrubGithubAppTokenEnv(),
      stdout: "ignore",
      stderr: "ignore",
    });
    const exit = await proc.exited;
    if (exit !== 0) {
      return { ok: false, tool: "gh", message: GH_AUTH_FAIL_MESSAGE };
    }
    return { ok: true };
  } catch {
    return { ok: false, tool: "gh", message: GH_AUTH_FAIL_MESSAGE };
  }
}
