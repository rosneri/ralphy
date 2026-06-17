/**
 * Per-worker memory cap.
 *
 * Every worker (and its descendants — the `claude` CLI, any Bash command it
 * runs such as a whole-monorepo `bun test`) shares the coordinator's cgroup by
 * default, so a single runaway process OOM-kills the entire fleet. When
 * `RALPH_WORKER_MEM_MAX` is set (e.g. "6G"), each worker is launched inside its
 * own transient systemd scope with that `MemoryMax`, so the kernel OOM-killer
 * kills only the offending worker's scope — the coordinator and sibling workers
 * survive. Same mechanism as scripts/agent-capped.sh, applied per worker.
 *
 * Requires `systemd-run` (Linux + systemd user session). When the cap is set
 * but `systemd-run` is unavailable, the command runs uncapped (best effort) —
 * the caller decides whether to warn.
 */

export const WORKER_MEM_MAX_ENV = "RALPH_WORKER_MEM_MAX";

/**
 * Wrap `cmd` so it runs in a memory-capped systemd scope when configured.
 * Returns a new array; never mutates the input. Returns `cmd` unchanged when
 * the cap env is unset/blank or `systemd-run` is unavailable.
 */
export function applyWorkerMemoryCap(
  cmd: string[],
  env: Record<string, string | undefined>,
  hasSystemdRun: boolean,
): string[] {
  const cap = env[WORKER_MEM_MAX_ENV]?.trim();
  if (!cap || !hasSystemdRun) return cmd;
  return [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
    // tear the scope down once the worker exits so units don't accumulate
    "--collect",
    "-p",
    `MemoryMax=${cap}`,
    "-p",
    "MemorySwapMax=0",
    "--",
    ...cmd,
  ];
}
