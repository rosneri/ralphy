import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import type { State, Engine } from "@ralphy/types";
import type { FeedEvent } from "@ralphy/engine/feed-events";
import {
  createLoopRunner,
  type LoopRunnerEvent,
  type LoopRunnerOptions,
} from "@ralphy/core/loop-runner";
import { STOP_REASONS, type StopReason, type LoopOptions } from "../loop";

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

const MACHINE_STOP_REASONS: ReadonlySet<string> = new Set(STOP_REASONS);

/** The TUI's StopMessage only renders machine stop reasons; runner-level
 *  stops ("cancelled", "signal", "error") close the pane like before. */
function toMachineStopReason(reason: string | null): StopReason | null {
  if (reason !== null && MACHINE_STOP_REASONS.has(reason)) return reason as StopReason;
  return null;
}

function toRunnerOptions(opts: LoopOptions): LoopRunnerOptions {
  const engine: Engine = opts.engine === "codex" ? "codex" : "claude";
  return {
    name: opts.name,
    prompt: opts.prompt,
    engine,
    model: opts.model,
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    limits: {
      maxIterations: opts.maxIterations,
      maxCostUsd: opts.maxCostUsd,
      maxRuntimeMinutes: opts.maxRuntimeMinutes,
      maxConsecutiveFailures: opts.maxConsecutiveFailures,
    },
    delaySeconds: opts.delay,
    ...(opts.phase !== undefined ? { phase: opts.phase } : {}),
    ...(opts.reviewPhase !== undefined ? { reviewPhase: opts.reviewPhase } : {}),
    ...(opts.onReviewRound !== undefined ? { onReviewRound: opts.onReviewRound } : {}),
    ...(opts.createPr !== undefined ? { createPr: opts.createPr } : {}),
    ...(opts.prDraft !== undefined ? { prDraft: opts.prDraft } : {}),
    manualTest: opts.manualTest,
    log: opts.log,
    ...(opts.metaPrompt !== undefined ? { metaPrompt: opts.metaPrompt } : {}),
    // The runner captures the ambient layout at construction time (we are
    // inside the CLI's runWithContext scope during the first render).
    deps: { changeStore: opts.changeStore },
  };
}

function toLogEntries(event: LoopRunnerEvent, nextId: () => string): LogEntry[] {
  switch (event.type) {
    case "iteration-started":
      return [
        {
          id: nextId(),
          kind: "iterationHeader",
          iteration: event.iteration,
          time: new Date().toLocaleTimeString("en-US", { hour12: false }),
        },
      ];
    case "info":
      return [{ id: nextId(), kind: "info", text: event.text }];
    case "feed":
      return [{ id: nextId(), kind: "feed", event: event.event }];
    default:
      return [];
  }
}

/**
 * Thin adapter over the headless `LoopRunner` (issue #401): subscribes for
 * log lines, mirrors the runner snapshot into React, and forwards steer.
 * All orchestration (state init, iteration driving, steering, review phase,
 * archive path, stop arithmetic) lives in `@ralphy/core/loop-runner`.
 */
export function useLoop(opts: LoopOptions): UseLoopResult {
  const [runner] = useState(() => createLoopRunner(toRunnerOptions(opts)));
  const [logLines, setLogLines] = useState<LogEntry[]>([]);
  const [startedAt] = useState(() => Date.now());
  const lineIdRef = useRef(0);

  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot);

  useEffect(() => {
    const nextId = () => String(lineIdRef.current++);
    const unsubscribe = runner.subscribe((event) => {
      const entries = toLogEntries(event, nextId);
      if (entries.length > 0) setLogLines((previous) => [...previous, ...entries]);
    });
    void runner.start();
    return () => {
      unsubscribe();
      runner.cancel();
    };
  }, [runner]);

  return {
    state: snapshot.state,
    iteration: snapshot.iteration,
    consecutiveFailures: snapshot.consecutiveFailures,
    logLines,
    stopReason: toMachineStopReason(snapshot.stopReason),
    isRunning: snapshot.isRunning,
    isResume: snapshot.isResume,
    startedAt,
    steer: (message: string) => runner.steer(message),
  };
}
