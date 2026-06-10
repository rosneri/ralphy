/**
 * When the loop runs as an agent worker its stdout is a pipe, so
 * `process.stdout.columns` is undefined and Ink falls back to wrapping at 80
 * columns no matter how wide the agent's terminal is. The agent passes its
 * usable card width via `RALPH_WORKER_COLUMNS`; applying it here lets the
 * worker's output use the full available width.
 */
export function applyWorkerColumnsOverride(
  stdout: { isTTY?: boolean; columns?: number } = process.stdout,
  environment: Record<string, string | undefined> = process.env,
): void {
  if (stdout.isTTY) return;
  const raw = environment["RALPH_WORKER_COLUMNS"];
  if (!raw) return;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 20) return;
  Object.defineProperty(stdout, "columns", { value: parsed, configurable: true });
}
