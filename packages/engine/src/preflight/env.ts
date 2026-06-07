export const CLAUDE_ENV_KEYS_TO_SCRUB = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_ENTRYPOINT",
  "AI_AGENT",
] as const;

export function scrubClaudeEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Record<string, string | undefined> {
  const copy: Record<string, string | undefined> = { ...env };
  for (const key of CLAUDE_ENV_KEYS_TO_SCRUB) {
    delete copy[key];
  }
  return copy;
}

/** Application-level GitHub token env vars that would shadow gh's own auth.
 *  Ralphy routes all GitHub operations (git push, PR create, checks) through
 *  gh, so it strips these before spawning git/gh — letting gh's dedicated
 *  credential win: `GH_TOKEN` if set (the documented gh override, used by CI),
 *  otherwise the stored `gh auth login`. `GITHUB_TOKEN` is commonly an app
 *  secret (e.g. auto-loaded from a project `.env`) that is NOT meant to
 *  authenticate the agent's git operations, yet both gh and git's credential
 *  helper prefer it over the keyring login — so it is dropped while `GH_TOKEN`
 *  is kept. */
export const GITHUB_APP_TOKEN_KEYS = ["GITHUB_TOKEN"] as const;

export function scrubGithubAppTokenEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Record<string, string | undefined> {
  const copy: Record<string, string | undefined> = { ...env };
  for (const key of GITHUB_APP_TOKEN_KEYS) {
    delete copy[key];
  }
  return copy;
}
