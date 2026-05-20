import { spawn } from "../spawn";
import { scrubClaudeEnv } from "./env";
import type { PreflightResult } from "./types";

export const CLAUDE_AUTH_FAIL_MESSAGE =
  "claude CLI is not authenticated. Run `claude` then `/login`, then restart the agent.";

const NOT_LOGGED_IN_RE = /Not logged in|Please run \/login/;
const PROBE_TIMEOUT_MS = 30_000;

export async function checkClaudeAuth(): Promise<PreflightResult> {
  try {
    const proc = spawn({
      cmd: ["claude", "-p", "say ok", "--output-format", "text"],
      env: scrubClaudeEnv(process.env as Record<string, string | undefined>),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    const exit = await proc.exited;
    if (exit !== 0 || NOT_LOGGED_IN_RE.test(stdout)) {
      return { ok: false, tool: "claude", message: CLAUDE_AUTH_FAIL_MESSAGE };
    }
    return { ok: true };
  } catch {
    return { ok: false, tool: "claude", message: CLAUDE_AUTH_FAIL_MESSAGE };
  }
}
