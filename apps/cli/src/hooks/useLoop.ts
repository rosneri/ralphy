import { useState, useEffect, useRef } from "react";
import { join } from "node:path";
import type { State } from "@ralphy/types";
import type { FeedEvent } from "@ralphy/engine/feed-events";
import { readState, writeState, buildInitialState, ensureState } from "@ralphy/core/state";
import { runEngine, handleEngineFailure } from "@ralphy/engine/engine";
import { gitPush, commitTaskDir } from "@ralphy/core/git";
import { getStorage, runWithContext, createDefaultContext } from "@ralphy/context";
import { capture } from "@ralphy/telemetry";
import {
  buildTaskPrompt,
  checkStopCondition,
  updateStateIteration,
  checkStopSignal,
  appendSteeringMessage,
  buildSteeringPrompt,
  mergeUsage,
  allCompleted,
  countUnchecked,
  type StopReason,
  type LoopOptions,
} from "../loop";

export type LogEntry =
  | { id: string; kind: "iterationHeader"; iteration: number; time: string }
  | { id: string; kind: "info"; text: string }
  | { id: string; kind: "feed"; event: FeedEvent };

interface UseLoopResult {
  state: State | null;
  iteration: number;
  consecutiveFailures: number;
  logLines: LogEntry[];
  stopReason: StopReason | null;
  isRunning: boolean;
  isResume: boolean;
  startedAt: number;
  /** Send a live steering message to the current engine session. */
  steer: (message: string) => void;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function useLoop(opts: LoopOptions): UseLoopResult {
  const [state, setState] = useState<State | null>(null);
  const [iteration, setIteration] = useState(0);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [logLines, setLogLines] = useState<LogEntry[]>([]);
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [isResume, setIsResume] = useState(false);
  const [startedAt] = useState(() => Date.now());

  const lineIdRef = useRef(0);
  const steerControllerRef = useRef<AbortController | null>(null);
  const pendingSteerRef = useRef<string | null>(null);

  const steer = (message: string) => {
    pendingSteerRef.current = message;
    steerControllerRef.current?.abort();
  };

  useEffect(() => {
    let cancelled = false;

    const nextId = () => String(lineIdRef.current++);

    const addInfo = (text: string) => {
      setLogLines((prev) => [...prev, { id: nextId(), kind: "info", text }]);
    };

    const addIterationHeader = (iterNum: number, time: string) => {
      setLogLines((prev) => [
        ...prev,
        { id: nextId(), kind: "iterationHeader", iteration: iterNum, time },
      ]);
    };

    const addFeedEvent = (event: FeedEvent) => {
      setLogLines((prev) => [...prev, { id: nextId(), kind: "feed", event }]);
    };

    runWithContext(createDefaultContext(), async () => {
      const stateDir = join(opts.statesDir, opts.name);
      const tasksDir = join(opts.tasksDir, opts.name);
      const storage = getStorage();

      // Init or resume state
      let currentState: State;
      const existingStateRaw = storage.read(join(stateDir, ".ralph-state.json"));
      if (existingStateRaw !== null) {
        currentState = readState(stateDir);
        if (currentState.engine !== opts.engine || currentState.model !== opts.model) {
          currentState = {
            ...currentState,
            engine: opts.engine as State["engine"],
            model: opts.model,
          };
          writeState(stateDir, currentState);
        }
      } else {
        currentState = buildInitialState({
          name: opts.name,
          prompt: opts.prompt,
          engine: opts.engine,
          model: opts.model,
        });
        writeState(stateDir, currentState);
      }

      const isResume = currentState.iteration > 0;
      setIsResume(isResume);
      setState(currentState);

      capture("task_started", {
        engine: opts.engine,
        model: opts.model,
        is_resume: isResume,
        has_prompt: opts.prompt.length > 0,
        max_iterations: opts.maxIterations,
        max_cost_usd: opts.maxCostUsd,
      });

      let iter = 0;
      const loopStartTime = Date.now();
      let consFailures = 0;
      let lastResult = "";
      let finalStopReason: StopReason | null = null;

      while (!cancelled) {
        currentState = readState(stateDir);
        setState(currentState);

        const stop = checkStopCondition(currentState, iter, opts, loopStartTime, consFailures);
        if (stop !== null) {
          finalStopReason = stop;
          setStopReason(stop);
          break;
        }

        // Check if all tasks are done
        const tasksContent = storage.read(join(tasksDir, "tasks.md"));
        if (tasksContent !== null) {
          const remaining = countUnchecked(tasksContent);
          addInfo(`tasks.md: ${remaining} unchecked item${remaining === 1 ? "" : "s"} remaining`);
        }
        if (tasksContent !== null && allCompleted(tasksContent)) {
          addInfo("All tasks completed — archiving change.");
          currentState = {
            ...currentState,
            status: "completed",
            lastModified: new Date().toISOString(),
          };
          writeState(stateDir, currentState);
          setState(currentState);
          try {
            await opts.changeStore.archiveChange(opts.name);
            addInfo("Change archived.");
          } catch (err) {
            addInfo(`Archive warning: ${err}`);
          }
          finalStopReason = "completed";
          setStopReason("completed");
          break;
        }

        iter++;
        setIteration(iter);

        const time = new Date().toLocaleTimeString("en-US", { hour12: false });
        addIterationHeader(iter, time);
        addInfo(`Iteration ${iter} (total: ${currentState.iteration})`);

        const prompt = buildTaskPrompt(currentState, tasksDir);

        const iterStart = new Date().toISOString();
        try {
          // Set up abort controller for live steering
          const controller = new AbortController();
          steerControllerRef.current = controller;
          pendingSteerRef.current = null;

          let engineResult = await runEngine({
            engine: opts.engine as import("@ralphy/types").Engine,
            model: opts.model,
            prompt,
            logFlag: opts.log,
            logFile: join(stateDir, "log.json"),
            taskDir: tasksDir,
            interactive: false,
            onFeedEvent: addFeedEvent,
            signal: controller.signal,
          });

          // Handle live steering: kill → resume with steering message
          while (pendingSteerRef.current !== null && engineResult.sessionId) {
            const steerMessage = pendingSteerRef.current;
            pendingSteerRef.current = null;

            appendSteeringMessage(tasksDir, steerMessage);
            addInfo(`Live steering: ${steerMessage}`);

            // Resume the session with the steering message
            const resumeController = new AbortController();
            steerControllerRef.current = resumeController;

            // Filter out session init events on resume — they're noise
            const addResumeFeedEvent = (event: FeedEvent) => {
              if (event.type === "session" || event.type === "session-unknown") return;
              addFeedEvent(event);
            };

            const resumeResult = await runEngine({
              engine: opts.engine as import("@ralphy/types").Engine,
              model: opts.model,
              prompt: buildSteeringPrompt(steerMessage),
              logFlag: opts.log,
              logFile: join(stateDir, "log.json"),
              taskDir: tasksDir,
              onFeedEvent: addResumeFeedEvent,
              signal: resumeController.signal,
              resumeSessionId: engineResult.sessionId,
            });

            resumeResult.usage = mergeUsage(engineResult.usage, resumeResult.usage);
            engineResult = resumeResult;
          }

          steerControllerRef.current = null;

          if (engineResult.exitCode !== 0) {
            const failure = handleEngineFailure(engineResult.exitCode);
            addInfo(failure.message);

            const result = `failed:exit-${engineResult.exitCode}`;
            updateStateIteration(
              stateDir,
              result,
              iterStart,
              opts.engine,
              opts.model,
              engineResult.usage,
            );

            // Stop immediately on rate limits or fatal engine errors
            if (failure.shouldStop || engineResult.rateLimited) {
              capture("engine_rate_limited", { exit_code: engineResult.exitCode, iteration: iter });
              finalStopReason = "rateLimited";
              setStopReason("rateLimited");
              break;
            }

            capture("iteration_failed", {
              exit_code: engineResult.exitCode,
              iteration: iter,
              consecutive_failures: consFailures + 1,
            });

            if (result === lastResult) {
              consFailures++;
            } else {
              consFailures = 1;
              lastResult = result;
            }
            setConsecutiveFailures(consFailures);

            continue;
          }

          // Success
          currentState = updateStateIteration(
            stateDir,
            "success",
            iterStart,
            opts.engine,
            opts.model,
            engineResult.usage,
          );
          setState(currentState);
          consFailures = 0;
          lastResult = "";
          setConsecutiveFailures(0);

          try {
            gitPush();
          } catch {
            // Push failures are non-fatal
          }

          const stopSignal = checkStopSignal(tasksDir, stateDir);
          if (stopSignal) {
            addInfo(`STOP signal: ${stopSignal.trim()}`);
            break;
          }

          addInfo(`Completed iteration ${iter}`);

          // Delay between iterations
          if (
            checkStopCondition(currentState, iter, opts, loopStartTime, consFailures) === null &&
            opts.delay > 0
          ) {
            addInfo(`Sleeping ${opts.delay}s before next iteration...`);
            await sleep(opts.delay);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          addInfo(`Engine error: ${err}`);
          capture("engine_error", { iteration: iter, error: message });
          break;
        }
      }

      currentState = ensureState(stateDir);
      setState(currentState);

      capture("task_stopped", {
        stop_reason: finalStopReason,
        iterations: iter,
        total_cost_usd: currentState.usage.total_cost_usd,
        total_duration_ms: Date.now() - loopStartTime,
        engine: opts.engine,
        model: opts.model,
      });

      addInfo(`Ralph loop finished after ${iter} iterations.`);

      if (iter > 0) {
        commitTaskDir(tasksDir, `change ${opts.name} finished`);
        try {
          gitPush();
        } catch {
          // Push failures are non-fatal
        }
      }

      setIsRunning(false);
    });

    return () => {
      cancelled = true;
    };
    // Effect should only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    iteration,
    consecutiveFailures,
    logLines,
    stopReason,
    isRunning,
    isResume,
    startedAt,
    steer,
  };
}
