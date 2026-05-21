/**
 * `worker-spawner` shared capability — wraps the `Bun.spawn` of the
 * `ralph task` worker subprocess so the call flows through the standard
 * capability shell (bus events, retry policy, error formatting).
 *
 * Two optional "courtesy" hooks may run before the spawn:
 *   - `steeringNote`  → appended via `fsChange.appendSteering`.
 *   - `prependTask`   → prepended via `fsChange.prependTask`.
 *
 * Both hooks are best-effort; failures inside them throw normally — the
 * shell rethrows and `worker.spawn.failed` is emitted. Production
 * callers that want stricter observability should drive `fsChange`
 * themselves so each step is its own bus event.
 *
 * Spawn shape is intentionally `{ exited, kill, pid }` — the heavy
 * stdout/stderr pumping + log file teeing remains in `wire.ts` so the
 * capability stays portable across test setups.
 */

import { NO_RETRY, type Capability } from "./types";
import { fsChange } from "./fs-change";
import { runCapability } from "./run-capability";

export interface WorkerSpawnHandle {
  exited: Promise<number>;
  kill: () => void;
  pid?: number;
}

export type WorkerSpawner = (cmd: string[], cwd: string) => WorkerSpawnHandle;

interface SpawnWorkerArgs {
  /** The subprocess command line (e.g. `["bun", "ralph", "loop", "task", "--name", "...", ...]`). */
  cmd: string[];
  cwd: string;
  changeName: string;
  /** Optional `Bun.spawn` override — when omitted, `Bun.spawn(...)` is used. */
  spawn?: WorkerSpawner;
  /** Optional courtesy hook — append the message to `steering.md` before spawn. */
  steeringNote?: { changeDir: string; message: string };
  /** Optional courtesy hook — prepend a `## <heading>` section to `tasks.md` before spawn. */
  prependTask?: { tasksPath: string; heading: string; failureOutput: string };
}

function defaultFormatter(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const defaultSpawner: WorkerSpawner = (cmd, cwd) => {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  return {
    exited: proc.exited,
    kill: () => proc.kill(),
    ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
  };
};

export const spawnWorker: Capability<SpawnWorkerArgs, WorkerSpawnHandle> = {
  name: "worker.spawn",
  required: false,
  retryPolicy: NO_RETRY,
  errorFormatter: defaultFormatter,
  run: async (args) => {
    if (args.steeringNote) {
      await runCapability(fsChange.appendSteering, args.steeringNote);
    }
    if (args.prependTask) {
      await runCapability(fsChange.prependTask, args.prependTask);
    }
    const spawn = args.spawn ?? defaultSpawner;
    return spawn(args.cmd, args.cwd);
  },
};
