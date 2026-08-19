import { spawn } from "../spawn";
import type { PreflightResult } from "./types";

/**
 * Tokenade readiness probe.
 *
 * Unlike the gh / claude checks, a Tokenade failure is not inherently fatal —
 * an unoptimized run still produces correct work, just a larger bill. So this
 * returns a normal `PreflightResult` and `runPreflight` decides, from
 * `tokenade.required`, whether to halt or merely warn.
 */
export const TOKENADE_MISSING_MESSAGE =
  "tokenade CLI not found on PATH. Install it with `npm install -g @tokenade/cli`, " +
  "then run `tokenade install` and `tokenade login` — or set `tokenade.enabled: false` " +
  "in WORKFLOW.md (or pass --no-tokenade) to run without it.";

export const TOKENADE_UNHEALTHY_MESSAGE =
  "tokenade CLI is installed but not ready. Run `tokenade healthcheck` to see which check " +
  "failed — most often the machine is not linked yet (`tokenade login`). Set " +
  "`tokenade.enabled: false` in WORKFLOW.md (or pass --no-tokenade) to run without it.";

const PROBE_TIMEOUT_MS = 30_000;

/** Exit code a shell reports for "command not found", which `Bun.spawn` can
 *  surface instead of throwing depending on how the binary shim fails. */
const COMMAND_NOT_FOUND_EXIT = 127;

export async function checkTokenade(): Promise<PreflightResult> {
  try {
    const proc = spawn({
      cmd: ["tokenade", "healthcheck"],
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const exitCode = await proc.exited;
    if (exitCode === COMMAND_NOT_FOUND_EXIT) {
      return { ok: false, tool: "tokenade", message: TOKENADE_MISSING_MESSAGE };
    }
    if (exitCode !== 0) {
      return { ok: false, tool: "tokenade", message: TOKENADE_UNHEALTHY_MESSAGE };
    }
    return { ok: true };
  } catch {
    // Bun.spawn throws on ENOENT — the binary is not installed at all.
    return { ok: false, tool: "tokenade", message: TOKENADE_MISSING_MESSAGE };
  }
}
