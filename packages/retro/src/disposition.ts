import { WORKER_EXIT_CODES } from "@ralphy/types";
import type { RetroDisposition } from "./types";

/**
 * Map a worker's effective exit code to a terminal `RetroDisposition`.
 *
 * `0 → "done"`, `72 → "no-changes"`, `70 → "ci-failed"`, `71 → "pr-failed"`,
 * any other non-zero → `"error"`.
 */
export function dispositionFromExitCode(code: number): RetroDisposition {
  switch (code) {
    case 0:
      return "done";
    case WORKER_EXIT_CODES.noChanges:
      return "no-changes";
    case WORKER_EXIT_CODES.ciFailed:
      return "ci-failed";
    case WORKER_EXIT_CODES.prFailed:
      return "pr-failed";
    default:
      return "error";
  }
}
