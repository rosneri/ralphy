import { createActor } from "xstate";
import type { Engine, State } from "@ralphy/types";
import type { FeedEvent } from "@ralphy/engine/feed-events";
import type { Agent } from "@ralphy/engine/engine";
import { OpenSpecChangeStore } from "@ralphy/openspec";
import {
  getStorage,
  getLayout,
  runWithContext,
  createDefaultContext,
  type ProjectLayout,
} from "@ralphy/context";
import { getProcessBus } from "@ralphy/events";
import { writeState, buildInitialState, tryReadStateRaw } from "../state";
import { gitPush, commitTaskDir, getUncommittedFiles } from "../git";
import { loopMachine } from "../machines";
import type { StopReason } from "../loop/stop-and-state";
import type {
  LoopChangeStore,
  MetaPromptOptions,
  ReviewPhaseConfig,
  ReviewRoundResult,
  TaskPhase,
} from "../loop";
import { executeLoop, type RunnerSignals } from "./runner-internals";

/**
 * Headless loop authority (issue #401).
 *
 * `createLoopRunner` owns the full loop lifecycle — state init/resume/salvage,
 * the iteration loop, live steering, the review phase, the archive path, and
 * all stop arithmetic — with the `loopMachine` actor as the only stop arbiter.
 * Front-ends (the Ink TUI hook, the sidecar WebSocket route) are thin event
 * consumers plus a `start`/`cancel`/`steer` command surface.
 *
 * This module must stay headless: importing React/Ink/WebSocket here is a
 * regression.
 */

/** Stop reasons the machine cannot express, surfaced by the runner itself:
 *  `"cancelled"` (cancel() or pre-start cancel), `"signal"` (a STOP file was
 *  consumed), `"error"` (the engine threw). Machine-derived `StopReason`s
 *  cover everything else. */
export type LoopRunnerStopReason = StopReason | "cancelled" | "signal" | "error";

/**
 * Canonical task-stream wire format — single authored union consumed by
 * `broadcast` and `useTaskStream`. Lives in `@ralphy/core` (not `@ralphy/events`)
 * to avoid a cycle. Version additions deliberately; `info` is a human-text escape hatch.
 */
export type LoopRunnerEvent =
  /** Emitted after every `.ralph-state.json` read/write the runner observes. */
  | { type: "state"; state: State }
  | { type: "iteration-started"; iteration: number; totalIteration: number; phase: TaskPhase }
  | { type: "iteration-finished"; iteration: number; result: "success" | `failed:${string}` }
  /** Engine stream passthrough. */
  | { type: "feed"; event: FeedEvent }
  | { type: "info"; text: string }
  | { type: "review-round"; result: ReviewRoundResult }
  | { type: "steering-applied"; message: string }
  | { type: "stopped"; reason: LoopRunnerStopReason; iterations: number };

export interface LoopRunnerSnapshot {
  state: State | null;
  /** Machine-derived, relative to this run (resumed iterations excluded). */
  iteration: number;
  /** Machine-derived. */
  consecutiveFailures: number;
  isRunning: boolean;
  isResume: boolean;
  stopReason: LoopRunnerStopReason | null;
}

export interface LoopRunnerLimits {
  maxIterations?: number;
  maxCostUsd?: number;
  maxRuntimeMinutes?: number;
  maxConsecutiveFailures?: number;
}

export interface LoopRunnerGit {
  push(): void;
  commitTaskDir(dir: string, message: string): void;
  getUncommittedFiles(): readonly string[];
}

export interface LoopRunnerDeps {
  changeStore?: LoopChangeStore;
  /** Engine port from `@ralphy/engine` protocol; tests inject a scripted fake. */
  agent?: Agent;
  layout?: ProjectLayout;
  git?: Partial<LoopRunnerGit>;
  sleep?: (seconds: number) => Promise<void>;
  /** Clock used for the loop start time (the machine's runtime-limit guard
   *  measures elapsed time from it). Tests inject a skewed clock. */
  now?: () => number;
}

export interface LoopRunnerOptions {
  /** The only required field. */
  name: string;
  prompt?: string;
  engine?: Engine;
  model?: string;
  /** Engine reasoning effort (`claude --effort`). Unset → engine default. */
  effort?: string;
  /** Model / effort for the planning phases (proposal/design/tasks). Unset
   *  falls back to `model` / `effort`. */
  planModel?: string;
  planEffort?: string;
  limits?: LoopRunnerLimits;
  delaySeconds?: number;
  /** Pin a prompt phase; default is `routeTaskPhase` auto-routing. */
  phase?: TaskPhase;
  reviewPhase?: ReviewPhaseConfig & {
    reviewerModel?: string;
    reviewerEffort?: string;
    reviewerContextStrategy?: "fresh" | "warm";
  };
  onReviewRound?: (result: ReviewRoundResult) => Promise<void>;
  createPr?: boolean;
  prDraft?: boolean;
  manualTest?: boolean;
  log?: boolean;
  metaPrompt?: MetaPromptOptions;
  deps?: LoopRunnerDeps;
}

export interface LoopRunner {
  /** Drives iterations until a machine-stopped state; resolves with the outcome. Idempotent. */
  start(): Promise<LoopRunnerStopReason>;
  /** Graceful cancel: aborts the current engine run, finalizes state, emits "stopped". */
  cancel(): void;
  /** Mid-iteration: abort → resume session; between iterations: queued into steering.md. */
  steer(message: string): void;
  /** Every observable change flows through here. Returns unsubscribe. */
  subscribe(listener: (event: LoopRunnerEvent) => void): () => void;
  /** Pull-based mirror for useSyncExternalStore; stable reference until the next event. */
  getSnapshot(): LoopRunnerSnapshot;
}

function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function createLoopRunner(options: LoopRunnerOptions): LoopRunner {
  const name = options.name;
  const prompt = options.prompt ?? "";
  const engine: Engine = options.engine ?? "claude";
  const model = options.model ?? "opus";
  const effort = options.effort;
  const planModel = options.planModel;
  const planEffort = options.planEffort;
  const limits = {
    maxIterations: options.limits?.maxIterations ?? 0,
    maxCostUsd: options.limits?.maxCostUsd ?? 0,
    maxRuntimeMinutes: options.limits?.maxRuntimeMinutes ?? 0,
    maxConsecutiveFailures: options.limits?.maxConsecutiveFailures ?? 5,
  };
  const delaySeconds = options.delaySeconds ?? 0;
  const deps = options.deps ?? {};
  const changeStore: LoopChangeStore = deps.changeStore ?? new OpenSpecChangeStore();
  const git: LoopRunnerGit = {
    push: gitPush,
    commitTaskDir,
    getUncommittedFiles,
    ...deps.git,
  };
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());

  // Capture an ambient layout at construction time when none is injected.
  // start() may run after the creating ALS scope has exited (e.g. a React
  // effect), so the reference must be saved synchronously here.
  let layout: ProjectLayout | null = deps.layout ?? null;
  if (layout === null) {
    try {
      layout = getLayout();
    } catch {
      layout = null;
    }
  }

  const listeners = new Set<(event: LoopRunnerEvent) => void>();
  // isRunning starts true: a runner exists to be started, and pull-based
  // consumers (the TUI's hold-to-close logic) must not observe a "finished"
  // snapshot between mount and the first event. It flips to false exactly
  // once, on the stopped event.
  let snapshot: LoopRunnerSnapshot = {
    state: null,
    iteration: 0,
    consecutiveFailures: 0,
    isRunning: true,
    isResume: false,
    stopReason: null,
  };

  let actor: ReturnType<typeof createActor<typeof loopMachine>> | null = null;
  let startingIteration = 0;
  // Shared with `cancel`/`steer` and the extracted iteration loop. Mutations
  // flow by reference so both sides observe the same engine controller and
  // pending steering message.
  const signals: RunnerSignals = {
    engineController: null,
    pendingSteer: null,
    cancelled: false,
  };
  let startPromise: Promise<LoopRunnerStopReason> | null = null;

  function emit(event: LoopRunnerEvent, patch: Partial<LoopRunnerSnapshot> = {}): void {
    const machineContext = actor?.getSnapshot().context;
    snapshot = {
      ...snapshot,
      ...(machineContext
        ? {
            iteration: machineContext.iteration - startingIteration,
            consecutiveFailures: machineContext.consecutiveFailures,
          }
        : {}),
      ...patch,
    };
    for (const listener of listeners) listener(event);
  }

  const info = (text: string) => emit({ type: "info", text });
  const onFeedEvent = (event: FeedEvent) => emit({ type: "feed", event });

  async function run(): Promise<LoopRunnerStopReason> {
    if (layout === null) {
      throw new Error(
        "createLoopRunner: no project layout available — pass deps.layout or create the runner inside a runWithContext scope that has one.",
      );
    }
    const ctx = createDefaultContext({ layout });
    return runWithContext(ctx, async () => {
      const stateDir = getLayout().taskStateDir(name);
      const tasksDir = getLayout().changeDir(name);
      const storage = getStorage();

      // Init or resume state. External writers (e.g. linear-sync) may have
      // partial-written `.ralph-state.json` before the loop scaffolded a full
      // state object, leaving a file that exists but fails schema validation.
      // Salvage by re-initialising rather than crashing — feature-owned slots
      // live in their own sidecar files and are unaffected.
      let currentState: State;
      const { state: parsedState, raw: rawState } = tryReadStateRaw(stateDir);
      if (parsedState !== null) {
        currentState = parsedState;
        if (currentState.engine !== engine || currentState.model !== model) {
          currentState = { ...currentState, engine, model };
          writeState(stateDir, currentState);
        }
      } else {
        if (rawState !== null) {
          info(
            `.ralph-state.json was malformed — reinitialising. Feature-owned slots (linearComments, specAttachments, …) live in their own sidecar files and are unaffected.`,
          );
        }
        currentState = buildInitialState({
          name,
          prompt,
          engine,
          model,
          manualTest: options.manualTest ?? false,
          createPr: options.createPr ?? false,
          prDraft: options.prDraft ?? false,
        });
        writeState(stateDir, currentState);
      }

      const isResume = currentState.iteration > 0;

      getProcessBus().emit({
        type: "loop.task_started",
        engine,
        model,
        is_resume: isResume,
        has_prompt: prompt.length > 0,
        max_iterations: limits.maxIterations,
        max_cost_usd: limits.maxCostUsd,
      });

      // Capture iterations already completed in prior runs so respawned workers
      // count toward the total maxIterations budget rather than resetting to 0.
      startingIteration = currentState.iteration;
      const startingCostUsd = currentState.usage.total_cost_usd;
      const loopStartTime = now();

      const loopActor = createActor(loopMachine).start();
      actor = loopActor;
      loopActor.send({
        type: "START",
        options: limits,
        startTime: loopStartTime,
        startingIteration,
        startingCostUsd,
        startingStatus: currentState.status,
      });

      emit(
        { type: "state", state: currentState },
        { state: currentState, isResume, isRunning: true },
      );

      return executeLoop({
        name,
        engine,
        model,
        effort,
        planModel,
        planEffort,
        delaySeconds,
        options,
        deps,
        changeStore,
        git,
        sleep,
        now,
        storage,
        stateDir,
        tasksDir,
        actor: loopActor,
        startingIteration,
        loopStartTime,
        signals,
        currentState,
        emit,
        info,
        onFeedEvent,
      });
    });
  }

  return {
    start() {
      startPromise ??= run();
      return startPromise;
    },

    cancel() {
      if (signals.cancelled) return;
      signals.cancelled = true;
      signals.engineController?.abort();
    },

    steer(message: string) {
      signals.pendingSteer = message;
      signals.engineController?.abort();
    },

    subscribe(listener: (event: LoopRunnerEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return snapshot;
    },
  };
}
