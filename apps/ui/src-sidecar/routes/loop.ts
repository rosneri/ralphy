import { join } from "node:path";
import { logJsonEvent, initWorkerLog } from "@ralphy/log";
import { mergeConfig, type CliOverrides } from "@ralphy/config";
import { loopOptionsFromConfig } from "@ralphy/config/loop-options";
import { loadWorkflow } from "@ralphy/workflow";
import { OpenSpecChangeStore } from "@ralphy/openspec";
import { runWithContext, createDefaultContext, getStorage } from "@ralphy/context";
import { projectLayout } from "@ralphy/core/layout";
import { createLoopRunner, type LoopRunner, type LoopRunnerEvent } from "@ralphy/core/loop-runner";
import { appendSteeringMessage, type LoopOptions } from "../loop-utils";
import { getActiveStreams } from "../streams";
import type { SidecarContext } from "../types";
import type { Engine } from "@ralphy/types";

// Track running loops so we can stop/steer them. The runner owns the loop
// lifecycle (state init, iterations, steering, review phase, stop arithmetic
// — see @ralphy/core/loop-runner, issue #401); this route is a thin adapter
// that broadcasts runner events over the task WebSocket.
const runningLoops = new Map<string, LoopRunner>();

export function isTaskRunning(taskName: string): boolean {
  return runningLoops.has(taskName);
}

interface RouteResult {
  status: number;
  body: unknown;
}

// Track active log files per task so broadcast can append entries
const taskLogFiles = new Map<string, string>();

function broadcast(taskName: string, message: LoopRunnerEvent | { type: string; message: string }) {
  const streams = getActiveStreams().get(taskName);
  if (streams) {
    const json = JSON.stringify(message);
    for (const ws of streams) {
      try {
        ws.send(json);
      } catch {
        // Client disconnected
      }
    }
  }
  const logFile = taskLogFiles.get(taskName);
  if (logFile) logJsonEvent(logFile, { ...message });
}

export async function loopRoutes(
  req: Request,
  route: { name: string; action: string },
  ctx: SidecarContext,
): Promise<RouteResult> {
  if (req.method !== "POST") {
    return { status: 405, body: { error: "Method not allowed" } };
  }

  const taskName = route.name;
  const taskDir = join(ctx.tasksDir, taskName);

  if (route.action === "stop") {
    const running = runningLoops.get(taskName);
    if (running) {
      running.cancel();
      runningLoops.delete(taskName);
    }
    // Also write a STOP signal file (covers loops owned by other processes)
    const storage = getStorage();
    storage.write(join(taskDir, "STOP"), "Stopped via UI");
    return { status: 200, body: { stopped: true } };
  }

  if (route.action === "steer") {
    const body = (await req.json()) as { message: string };
    const running = runningLoops.get(taskName);
    if (running) {
      // Mid-iteration: the runner aborts and resumes the session with the
      // message; between iterations it queues into steering.md.
      running.steer(body.message);
    } else {
      // No sidecar-owned loop — leave the message in steering.md for
      // whichever process runs the task next.
      await runWithContext(createDefaultContext(), async () => {
        appendSteeringMessage(taskDir, body.message);
      });
    }
    return { status: 200, body: { steered: true } };
  }

  if (route.action === "start") {
    if (runningLoops.has(taskName)) {
      return { status: 409, body: { error: "Task is already running" } };
    }

    const body = (await req.json()) as Partial<LoopOptions>;

    // One merge path with the CLIs: the request body is a sparse override
    // layer over WORKFLOW.md (cli > workflow > default) — no hand-filled
    // defaults here.
    const overrides: CliOverrides = {
      ...(body.engine === "claude" || body.engine === "codex" ? { engine: body.engine } : {}),
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.maxIterations !== undefined ? { maxIterations: body.maxIterations } : {}),
      ...(body.maxCostUsd !== undefined ? { maxCostUsd: body.maxCostUsd } : {}),
      ...(body.maxRuntimeMinutes !== undefined
        ? { maxRuntimeMinutes: body.maxRuntimeMinutes }
        : {}),
      ...(body.maxConsecutiveFailures !== undefined
        ? { maxConsecutiveFailures: body.maxConsecutiveFailures }
        : {}),
      ...(body.delay !== undefined ? { delay: body.delay } : {}),
      ...(body.log !== undefined ? { log: body.log } : {}),
      ...(body.verbose !== undefined ? { verbose: body.verbose } : {}),
      ...(body.manualTest !== undefined ? { manualTest: body.manualTest } : {}),
    };
    const { config } = await loadWorkflow(ctx.projectRoot);
    const { effective } = mergeConfig(config, overrides);
    const opts: LoopOptions = loopOptionsFromConfig(effective, {
      name: taskName,
      prompt: body.prompt ?? "",
      changeStore: new OpenSpecChangeStore(),
    });

    // Clear any leftover STOP signal from a previous run
    const storage = getStorage();
    storage.remove(join(taskDir, "STOP"));

    // Initialize log file for this run
    const logFile = join(taskDir, "LOG.jsonl");
    await initWorkerLog(logFile);
    taskLogFiles.set(taskName, logFile);

    const engine: Engine = opts.engine === "codex" ? "codex" : "claude";
    const runner = createLoopRunner({
      name: taskName,
      prompt: opts.prompt,
      engine,
      model: opts.model,
      limits: {
        maxIterations: opts.maxIterations,
        maxCostUsd: opts.maxCostUsd,
        maxRuntimeMinutes: opts.maxRuntimeMinutes,
        maxConsecutiveFailures: opts.maxConsecutiveFailures,
      },
      delaySeconds: opts.delay,
      log: opts.log,
      manualTest: opts.manualTest,
      ...(opts.reviewPhase !== undefined ? { reviewPhase: opts.reviewPhase } : {}),
      deps: {
        layout: projectLayout(ctx.projectRoot),
        changeStore: opts.changeStore,
      },
    });
    // LoopRunnerEvent is the WebSocket wire format.
    runner.subscribe((event) => broadcast(taskName, event));
    runningLoops.set(taskName, runner);

    runner
      .start()
      .catch((err) => {
        broadcast(taskName, { type: "error", message: String(err) });
      })
      .finally(() => {
        runningLoops.delete(taskName);
        taskLogFiles.delete(taskName);
      });

    return { status: 200, body: { started: true } };
  }

  return { status: 404, body: { error: "Unknown action" } };
}
