import type { Bus } from "@ralphy/events";

/** Minimal contract for the "log file" the runtime owns. */
interface ShutdownLog {
  close: () => Promise<void> | void;
}

/** Minimal runtime contract — `stopped` flag + active-flow iteration. */
interface ShutdownRuntime {
  stop: () => void;
  /** Active flows for `teardown('cancelled')`. Empty array is fine. */
  activeFlows: () => readonly ShutdownFlow[];
}

interface ShutdownFlow {
  flowId: string;
  teardown?: (reason: "cancelled") => Promise<void> | void;
}

interface ProcessLike {
  on: (sig: string, h: () => void) => void;
  off?: (sig: string, h: () => void) => void;
  exit: (code: number) => void;
}

interface InstallShutdownDeps {
  runtime: ShutdownRuntime;
  bus?: Bus;
  log?: ShutdownLog;
  /** Hard timeout for the parallel teardown pass. Default 10000 ms. */
  budgetMs?: number;
  /**
   * Process-like surface for tests. Defaults to the real `process`.
   * Tests pass a fake to avoid touching the actual signal handlers.
   */
  proc?: ProcessLike;
}

/**
 * Install a single SIGINT/SIGTERM handler. First signal: graceful
 * shutdown (parallel teardown ≤ budgetMs, bus.flush, log close, exit 0).
 * Second signal: immediate exit 130.
 *
 * Returns a disposer that removes the handlers (useful for tests).
 *
 * @public Imported by `shutdown.test.ts` via a string-fixture subprocess;
 * knip can't trace dynamic-fixture imports, so this tag keeps it exported.
 */
export function installShutdown(deps: InstallShutdownDeps): () => void {
  const proc: ProcessLike = deps.proc ?? {
    on: (sig, h) => {
      process.on(sig as NodeJS.Signals, h);
    },
    off: (sig, h) => {
      process.off(sig as NodeJS.Signals, h);
    },
    exit: (code) => {
      process.exit(code);
    },
  };
  const budgetMs = deps.budgetMs ?? 10_000;
  let shuttingDown = false;

  const handler = (signal: string): (() => void) => {
    return () => {
      if (shuttingDown) {
        proc.exit(130);
        return;
      }
      shuttingDown = true;
      void runShutdown(signal);
    };
  };

  const sigintHandler = handler("SIGINT");
  const sigtermHandler = handler("SIGTERM");
  proc.on("SIGINT", sigintHandler);
  proc.on("SIGTERM", sigtermHandler);

  async function runShutdown(signal: string): Promise<void> {
    const started = Date.now();
    deps.bus?.emit({ type: "runtime.shutdown.started", signal });
    deps.runtime.stop();

    const flows = deps.runtime.activeFlows();
    const tasks = flows.map(async (flow) => {
      try {
        await flow.teardown?.("cancelled");
        deps.bus?.emit({
          type: `runtime.shutdown.teardown.${flow.flowId}` as `runtime.shutdown.teardown.${string}`,
        });
      } catch (err) {
        deps.bus?.emit({
          type: `runtime.shutdown.teardown.${flow.flowId}` as `runtime.shutdown.teardown.${string}`,
          ok: false,
          error: (err as Error).message,
        });
      }
    });
    await Promise.race([
      Promise.all(tasks),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, budgetMs);
        t.unref();
      }),
    ]);

    // bus.flush isn't part of the Bus contract — best-effort
    const busWithFlush = deps.bus as (Bus & { flush?: () => Promise<void> }) | undefined;
    const maybeFlush = busWithFlush?.flush;
    if (typeof maybeFlush === "function") {
      try {
        await maybeFlush.call(busWithFlush);
      } catch {
        /* swallow — shutdown must not throw */
      }
    }

    deps.bus?.emit({
      type: "runtime.shutdown.completed",
      durationMs: Date.now() - started,
    });

    try {
      await deps.log?.close();
    } catch {
      /* swallow */
    }

    proc.exit(0);
  }

  return () => {
    proc.off?.("SIGINT", sigintHandler);
    proc.off?.("SIGTERM", sigtermHandler);
  };
}

/**
 * Helper used by the legacy entry points (`json-runner.ts`,
 * `AgentMode.tsx`) so their SIGINT/SIGTERM handlers delegate the
 * "stop coordinator, wait ≤10s for workers, force-exit on overrun"
 * loop here instead of inlining it. Returns a promise that resolves
 * when either every active worker has exited or the budget elapsed.
 *
 * Behavior:
 *   - Calls `stop()` once.
 *   - Polls `getActiveCount()` every 100 ms.
 *   - At 5000 ms emits a one-shot warn via `onWarn`.
 *   - At `budgetMs` (default 10_000) calls `onTimeout` and resolves.
 */
interface WaitForActiveWorkersDeps {
  stop: () => void;
  getActiveCount: () => number;
  budgetMs?: number;
  warnAtMs?: number;
  onWarn?: (activeCount: number) => void;
  onTimeout?: (activeCount: number) => void;
}

export async function waitForActiveWorkers(deps: WaitForActiveWorkersDeps): Promise<void> {
  const budgetMs = deps.budgetMs ?? 10_000;
  const warnAtMs = deps.warnAtMs ?? 5000;
  deps.stop();
  await new Promise<void>((resolve) => {
    const start = Date.now();
    let warned = false;
    const wait = setInterval(() => {
      const active = deps.getActiveCount();
      const elapsed = Date.now() - start;
      if (active === 0) {
        clearInterval(wait);
        resolve();
        return;
      }
      if (!warned && elapsed >= warnAtMs) {
        warned = true;
        deps.onWarn?.(active);
      }
      if (elapsed >= budgetMs) {
        clearInterval(wait);
        deps.onTimeout?.(active);
        resolve();
      }
    }, 100);
  });
}
