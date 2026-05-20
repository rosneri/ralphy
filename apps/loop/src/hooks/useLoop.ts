import { useState, useEffect, useRef } from "react";
import { join } from "node:path";
import type { State } from "@ralphy/types";
import type { FeedEvent } from "@ralphy/engine/feed-events";
import {
  readState,
  writeState,
  buildInitialState,
  ensureState,
  tryReadStateRaw,
} from "@ralphy/core/state";
import { runEngine, handleEngineFailure } from "@ralphy/engine/engine";
import { gitPush, commitTaskDir } from "@ralphy/core/git";
import { getStorage, runWithContext, createDefaultContext } from "@ralphy/context";
import { capture as telemetryCapture } from "@ralphy/telemetry";
import { getProcessBus } from "@ralphy/events";

function capture(event: string, properties?: Record<string, unknown>): void {
  telemetryCapture(event, properties);
  getProcessBus().emit({ type: event, ...properties } as never);
}
import {
  buildTaskPrompt,
  checkStopCondition,
  updateStateIteration,
  checkStopSignal,
  appendSteeringMessage,
  buildSteeringPrompt,
  mergeUsage,
  allTasksCompleted,
  countUncheckedTasks,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
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

      // Init or resume state. External writers (e.g. linear-sync) may have
      // partial-written `.ralph-state.json` before the loop scaffolded a full
      // state object, leaving a file that exists but fails schema validation.
      // Salvage any non-schema fields (linearComments, etc.) and re-init
      // rather than crashing.
      let currentState: State;
      const { state: parsedState, raw: rawState } = tryReadStateRaw(stateDir);
      if (parsedState !== null) {
        currentState = parsedState;
        if (currentState.engine !== opts.engine || currentState.model !== opts.model) {
          currentState = {
            ...currentState,
            engine: opts.engine as State["engine"],
            model: opts.model,
          };
          writeState(stateDir, currentState);
        }
      } else {
        if (rawState !== null) {
          addInfo(
            `.ralph-state.json was malformed — reinitialising. External fields (linearComments, specAttachments) preserved.`,
          );
        }
        currentState = buildInitialState({
          name: opts.name,
          prompt: opts.prompt,
          engine: opts.engine,
          model: opts.model,
          manualTest: opts.manualTest,
          createPr: opts.createPr ?? false,
        });
        // Carry over linearComments / specAttachments if linear-sync wrote
        // them before the loop could scaffold full state — otherwise we'd
        // orphan the sticky comment + attachment ids and create duplicates
        // on the next sync.
        if (rawState !== null && rawState.linearComments) {
          (currentState as Record<string, unknown>).linearComments = rawState.linearComments;
        }
        if (rawState !== null && rawState.specAttachments) {
          (currentState as Record<string, unknown>).specAttachments = rawState.specAttachments;
        }
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
          break;
        }

        // Check if all tasks are done. The change is considered complete
        // only when both mission tasks (`tasks.md`) and internal flow
        // tasks (`agent-tasks.md`) have zero unchecked items.
        const tasksContent = storage.read(join(tasksDir, MISSION_TASKS_FILENAME));
        const agentTasksContent = storage.read(join(tasksDir, AGENT_TASKS_FILENAME));

        // If the mission tasks file is missing AND the change is no longer in
        // the active list, it was archived out from under the loop (e.g. by the
        // agent running `openspec archive` directly). Exit instead of
        // respawning forever on a no-op iteration. A fresh run with no
        // tasks.md and no registered change still falls through so the engine
        // can scaffold on its first turn.
        if (
          tasksContent === null &&
          currentState.iteration > 0 &&
          typeof opts.changeStore.listChanges === "function"
        ) {
          let stillActive = true;
          try {
            const active = await opts.changeStore.listChanges();
            stillActive = active.includes(opts.name);
          } catch {
            stillActive = true;
          }
          if (!stillActive) {
            addInfo(
              `tasks.md not found and change "${opts.name}" is no longer active — it was archived externally. Exiting.`,
            );
            currentState = {
              ...currentState,
              status: "completed",
              lastModified: new Date().toISOString(),
            };
            writeState(stateDir, currentState);
            setState(currentState);
            finalStopReason = "completed";
            break;
          }
        }

        if (tasksContent !== null) {
          const remaining = countUncheckedTasks(tasksContent);
          const agentRemaining =
            agentTasksContent !== null ? countUncheckedTasks(agentTasksContent) : 0;
          const parts = [
            `tasks.md: ${remaining} unchecked item${remaining === 1 ? "" : "s"} remaining`,
          ];
          if (agentTasksContent !== null) {
            parts.push(
              `agent-tasks.md: ${agentRemaining} unchecked item${agentRemaining === 1 ? "" : "s"} remaining`,
            );
          }
          addInfo(parts.join(" · "));
        }
        const missionDone = tasksContent !== null && allTasksCompleted(tasksContent);
        const agentDone = agentTasksContent === null || allTasksCompleted(agentTasksContent);
        if (missionDone && agentDone && tasksContent !== null) {
          addInfo("All tasks completed — archiving change.");
          currentState = {
            ...currentState,
            status: "completed",
            lastModified: new Date().toISOString(),
          };
          writeState(stateDir, currentState);
          setState(currentState);
          try {
            if (typeof opts.changeStore.getStatus === "function") {
              const status = await opts.changeStore.getStatus(opts.name);
              if (!status.isComplete) {
                const blocked = status.artifacts
                  .filter((a) => a.status !== "done")
                  .map((a) => `${a.id}=${a.status}`)
                  .join(", ");
                addInfo(
                  `Archive skipped: openspec status reports change incomplete (${blocked || "no artifacts"}).`,
                );
                throw new Error("openspec status: change not complete");
              }
            }
            await opts.changeStore.archiveChange(opts.name);
            addInfo("Change archived.");
          } catch (err) {
            addInfo(`Archive warning: ${err}`);
          }
          finalStopReason = "completed";
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

      if (finalStopReason !== null) {
        setStopReason(finalStopReason);
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
