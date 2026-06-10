import { join } from "node:path";
import { logJsonEvent, initWorkerLog } from "@ralphy/log";
import { loopOptionsFromConfig, mergeConfig, type CliOverrides } from "@ralphy/config";
import { loadWorkflow } from "@ralphy/workflow";
import { OpenSpecChangeStore } from "@ralphy/openspec";
import { runWithContext, createDefaultContext, getStorage, getLayout } from "@ralphy/context";
import { projectLayout } from "@ralphy/core/layout";
import { readState, writeState, buildInitialState } from "@ralphy/core/state";
import { runEngine, handleEngineFailure } from "@ralphy/engine/engine";
import { gitPush, commitTaskDir } from "@ralphy/core/git";
import {
  buildTaskPrompt,
  checkStopCondition,
  updateStateIteration,
  checkStopSignal,
  appendSteeringMessage,
  buildSteeringPrompt,
  mergeUsage,
  type LoopOptions,
} from "../loop-utils";
import { getActiveStreams } from "../streams";
import type { SidecarContext } from "../types";
import type { Engine, FeedEvent, State } from "@ralphy/types";

// Track running loops so we can stop them
const runningLoops = new Map<string, { cancel: () => void }>();

export function isTaskRunning(taskName: string): boolean {
  return runningLoops.has(taskName);
}

// Track the current engine AbortController per task so steering can kill it
const engineAbortControllers = new Map<string, AbortController>();

// Track pending steering messages per task (set by steer endpoint, consumed by loop)
const pendingSteerMessages = new Map<string, string>();

interface RouteResult {
  status: number;
  body: unknown;
}

// Track active log files per task so broadcast can append entries
const taskLogFiles = new Map<string, string>();

function broadcast(taskName: string, message: Record<string, unknown>) {
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
  if (logFile) logJsonEvent(logFile, message);
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
    // Also write a STOP signal file
    const storage = getStorage();
    storage.write(join(taskDir, "STOP"), "Stopped via UI");
    return { status: 200, body: { stopped: true } };
  }

  if (route.action === "steer") {
    const body = (await req.json()) as { message: string };
    // Append to STEERING.md using shared helper
    await runWithContext(createDefaultContext(), async () => {
      appendSteeringMessage(taskDir, body.message);
    });
    // Store pending message and kill the current engine so the loop can resume with it
    pendingSteerMessages.set(taskName, body.message);
    const ac = engineAbortControllers.get(taskName);
    if (ac) {
      ac.abort();
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

    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    runningLoops.set(taskName, { cancel });

    // Run loop in background
    runLoopAsync(taskName, taskDir, opts, () => cancelled, ctx.projectRoot)
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

async function runLoopAsync(
  taskName: string,
  taskDir: string,
  opts: LoopOptions,
  isCancelled: () => boolean,
  projectRoot: string,
): Promise<void> {
  await runWithContext(createDefaultContext({ layout: projectLayout(projectRoot) }), async () => {
    const storage = getStorage();

    // Initialize log file for this run
    const logFile = join(taskDir, "LOG.jsonl");
    await initWorkerLog(logFile);
    taskLogFiles.set(taskName, logFile);

    // Init or resume state
    let currentState: State;
    const existingState = storage.read(join(taskDir, ".ralph-state.json"));
    if (existingState !== null) {
      currentState = readState(taskDir);
      if (currentState.engine !== opts.engine || currentState.model !== opts.model) {
        currentState = { ...currentState, engine: opts.engine as Engine, model: opts.model };
        writeState(taskDir, currentState);
      }
    } else {
      currentState = buildInitialState({
        name: opts.name,
        prompt: opts.prompt,
        engine: opts.engine,
        model: opts.model,
      });
      writeState(taskDir, currentState);
    }

    broadcast(taskName, { type: "state", state: currentState });

    let iter = 0;
    const loopStartTime = Date.now();
    let consFailures = 0;
    let lastResult = "";

    while (!isCancelled()) {
      currentState = readState(taskDir);
      broadcast(taskName, { type: "state", state: currentState });

      const stop = checkStopCondition(currentState, iter, opts, loopStartTime, consFailures);
      if (stop !== null) {
        broadcast(taskName, { type: "stopped", reason: stop });
        break;
      }

      iter++;
      broadcast(taskName, {
        type: "info",
        text: `Iteration ${iter}`,
      });

      const prompt = buildTaskPrompt(currentState, taskDir);
      const iterStart = new Date().toISOString();

      try {
        const onFeedEvent = (event: FeedEvent) => {
          broadcast(taskName, { type: "feed", event });
        };

        // Create an AbortController so steering can kill this iteration
        const ac = new AbortController();
        engineAbortControllers.set(taskName, ac);
        pendingSteerMessages.delete(taskName);

        let engineResult = await runEngine({
          engine: opts.engine as Engine,
          model: opts.model,
          prompt,
          logFlag: opts.log,
          taskDir,

          cwd: projectRoot,
          onFeedEvent,
          signal: ac.signal,
        });

        // Handle live steering: kill → resume with steering message
        while (pendingSteerMessages.has(taskName) && engineResult.sessionId) {
          const steerMessage = pendingSteerMessages.get(taskName)!;
          pendingSteerMessages.delete(taskName);

          broadcast(taskName, {
            type: "info",
            text: `Live steering: ${steerMessage}`,
          });

          const resumeAc = new AbortController();
          engineAbortControllers.set(taskName, resumeAc);

          // Filter out session init events on resume — they're noise
          const onResumeFeedEvent = (event: FeedEvent) => {
            if (event.type === "session" || event.type === "session-unknown") return;
            onFeedEvent(event);
          };

          const resumeResult = await runEngine({
            engine: opts.engine as Engine,
            model: opts.model,
            prompt: buildSteeringPrompt(steerMessage),
            logFlag: opts.log,
            taskDir,

            cwd: projectRoot,
            onFeedEvent: onResumeFeedEvent,
            signal: resumeAc.signal,
            resumeSessionId: engineResult.sessionId,
          });

          resumeResult.usage = mergeUsage(engineResult.usage, resumeResult.usage);
          engineResult = resumeResult;
        }

        engineAbortControllers.delete(taskName);

        if (engineResult.exitCode !== 0) {
          const failure = handleEngineFailure(engineResult.exitCode);
          broadcast(taskName, { type: "info", text: failure.message });

          const result = `failed:exit-${engineResult.exitCode}`;
          updateStateIteration(
            taskDir,
            result,
            iterStart,
            opts.engine,
            opts.model,
            engineResult.usage,
          );

          // Stop immediately on rate limits or fatal engine errors
          if (failure.shouldStop || engineResult.rateLimited) {
            broadcast(taskName, { type: "stopped", reason: "rateLimited" });
            break;
          }

          if (result === lastResult) {
            consFailures++;
          } else {
            consFailures = 1;
            lastResult = result;
          }
          continue;
        }

        // Success
        currentState = updateStateIteration(
          taskDir,
          "success",
          iterStart,
          opts.engine,
          opts.model,
          engineResult.usage,
        );
        broadcast(taskName, { type: "state", state: currentState });
        consFailures = 0;
        lastResult = "";

        try {
          gitPush();
        } catch {
          // Non-fatal
        }

        const stopSignal = checkStopSignal(taskDir, getLayout().taskStateDir(taskName));
        if (stopSignal) {
          broadcast(taskName, { type: "stopped", reason: "signal" });
          break;
        }

        // Delay between iterations
        if (
          checkStopCondition(currentState, iter, opts, loopStartTime, consFailures) === null &&
          opts.delay > 0
        ) {
          await new Promise((resolve) => setTimeout(resolve, opts.delay * 1000));
        }
      } catch (err) {
        broadcast(taskName, { type: "error", message: String(err) });
        break;
      }
    }

    // Final state
    currentState = readState(taskDir);
    if (currentState.status === "completed") {
      const now = new Date().toISOString();
      currentState = {
        ...currentState,
        lastModified: now,
        history: [
          ...currentState.history,
          {
            timestamp: now,
            iteration: 0,
            engine: currentState.engine,
            model: currentState.model,
            result: "change completed",
          },
        ],
      };
      writeState(taskDir, currentState);
    }

    broadcast(taskName, { type: "state", state: currentState });

    if (iter > 0) {
      commitTaskDir(taskDir, `task ${opts.name} finished`);
      try {
        gitPush();
      } catch {
        // Non-fatal
      }
    }

    broadcast(taskName, { type: "stopped", reason: "finished" });
  });
}
