import type { RetroDisposition } from "./types";

// These mirror the exit-code constants in
// `apps/agent/src/agent/post-task.ts`. They are duplicated here as named
// consts (rather than imported) so this package does not depend on the agent
// app. Keep them in sync with post-task.ts.
/** Worker exited 0 but the CI fix loop never reached green. */
// allow-duplicate
const CI_FAILED_EXIT = 70;
/** Worker exited 0 but the residual-commit / push / PR-create path failed. */
// allow-duplicate
const PR_FAILED_EXIT = 71;
/** Worker exited 0 and finished, but the branch shipped no substantive change. */
// allow-duplicate
const NO_CHANGES_EXIT = 72;

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
    case NO_CHANGES_EXIT:
      return "no-changes";
    case CI_FAILED_EXIT:
      return "ci-failed";
    case PR_FAILED_EXIT:
      return "pr-failed";
    default:
      return "error";
  }
}
