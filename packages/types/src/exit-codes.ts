/**
 * Worker process exit codes — the canonical parent↔child worker IPC contract.
 *
 * A child worker subprocess signals its terminal outcome to the parent via its
 * numeric exit code. These three non-zero codes are *successful-but-special*
 * outcomes (distinct from `0` = success-with-PR and arbitrary non-zero =
 * crash/failure). Defined once here and imported everywhere so the contract
 * cannot drift across packages.
 *
 * - `ciFailed` (70): worker exited 0 but the CI fix loop never reached green.
 * - `prFailed` (71): worker exited 0 but the residual-commit / push / PR-create
 *   path failed.
 * - `noChanges` (72): worker exited 0 and finished, but the branch shipped no
 *   substantive change — finalized as an honest "no changes needed" no-op.
 */
export const WORKER_EXIT_CODES = {
  ciFailed: 70,
  prFailed: 71,
  noChanges: 72,
} as const;

export type WorkerExitCode = (typeof WORKER_EXIT_CODES)[keyof typeof WORKER_EXIT_CODES];
