import { spawn } from "../spawn";
import { resolveTokenadeCommand } from "../tokenade";
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
  "tokenade CLI could not be run. It ships with Ralphy as an optional dependency, so this " +
  "usually means the install skipped it (--no-optional / --ignore-scripts, or an unsupported " +
  "platform): reinstall Ralphy, or install it yourself with `npm install -g @tokenade/cli`. " +
  "Set `tokenade.enabled: false` in WORKFLOW.md (or pass --no-tokenade) to run without it.";

export const TOKENADE_UNHEALTHY_MESSAGE =
  "tokenade CLI is present but not ready. Run `ralphy tokenade healthcheck` to see which " +
  "check failed — most often the machine is not linked yet (`ralphy tokenade login`) or the " +
  "agent hooks are not installed (`ralphy tokenade install`). Set `tokenade.enabled: false` " +
  "in WORKFLOW.md (or pass --no-tokenade) to run without it.";

const PROBE_TIMEOUT_MS = 30_000;

/** Exit code a shell reports for "command not found", which `Bun.spawn` can
 *  surface instead of throwing depending on how the binary shim fails. */
const COMMAND_NOT_FOUND_EXIT = 127;

export async function checkTokenade(): Promise<PreflightResult> {
  try {
    const proc = spawn({
      cmd: [...resolveTokenadeCommand().command, "healthcheck"],
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
