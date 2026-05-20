import { checkGhAuth } from "./gh";
import { checkClaudeAuth } from "./claude";
import type { PreflightResult } from "./types";

export async function runPreflight(): Promise<PreflightResult> {
  const gh = await checkGhAuth();
  if (!gh.ok) return gh;
  const claude = await checkClaudeAuth();
  if (!claude.ok) return claude;
  return { ok: true };
}
