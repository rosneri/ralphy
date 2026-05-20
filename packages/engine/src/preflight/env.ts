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
