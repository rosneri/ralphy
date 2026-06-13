import { join } from "node:path";
import { createActor } from "xstate";
import type { Engine, State } from "@ralphy/types";
import type { FeedEvent } from "@ralphy/engine/feed-events";
import { runEngine, handleEngineFailure, type Agent } from "@ralphy/engine/engine";
import { OpenSpecChangeStore } from "@ralphy/openspec";
import {
  getStorage,
  getLayout,
  runWithContext,
  createDefaultContext,
  type ProjectLayout,
} from "@ralphy/context";
import { getProcessBus } from "@ralphy/events";
import { writeState, updateState, buildInitialState, ensureState, tryReadStateRaw } from "../state";
import { countOpenFindings } from "../openspec/phase";
import { gitPush, commitTaskDir, getUncommittedFiles } from "../git";
import { loopMachine, stoppedStateToReason } from "../machines";
import {
  buildPhasePrompt,
  routeTaskPhase,
  updateStateIteration,
  checkStopSignal,
  appendSteeringMessage,
  buildSteeringPrompt,
  mergeUsage,
  allTasksCompleted,
  countUncheckedTasks,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
  type LoopChangeStore,
  type MetaPromptOptions,
  type ReviewPhaseConfig,
  type ReviewRoundResult,
  type StopReason,
  type TaskPhase,
} from "../loop";

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
 * The canonical task-stream wire format — the public contract and the
 * de-facto WebSocket payload broadcast to the web UI. This is the single
 * authored union for task-stream events; clients (the sidecar `broadcast`,
 * the `useTaskStream` hook) consume it rather than re-declaring their own.
 * Version additions deliberately; `info` is a human-text escape hatch that
 * clients must not parse.
 *
 * It intentionally lives here in `@ralphy/core` and NOT in `@ralphy/events`:
 * its variants reference core-owned types (`State`, `FeedEvent`,
 * `ReviewRoundResult`, `TaskPhase`, `LoopRunnerStopReason`), so hoisting it
 * into `@ralphy/events` — which `@ralphy/core` already depends on — would
 * create an `events → core → events` dependency cycle. The wider-bus event
 * union (`RalphEvent`) stays in `@ralphy/events`; this task-stream union
 * stays here.
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
  limits?: LoopRunnerLimits;
  delaySeconds?: number;
  /** Pin a prompt phase; default is `routeTaskPhase` auto-routing. */
  phase?: TaskPhase;
  reviewPhase?: ReviewPhaseConfig & {
    reviewerModel?: string;
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
  let engineController: AbortController | null = null;
  let pendingSteer: string | null = null;
  let cancelled = false;
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

      actor = createActor(loopMachine).start();
      actor.send({
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

      // Stops the runner itself decides (the machine cannot express these).
      let runnerStop: "signal" | "error" | null = null;

      while (!cancelled) {
        // Defense-in-depth: writes are atomic now, but if a partial or
        // schema-invalid `.ralph-state.json` is ever observed here, keep the
        // last known good `currentState` and retry on the next tick rather
        // than throwing (an uncaught throw wedges the worker — it never
        // transitions to error/done and hangs as "working").
        const { state: polled } = tryReadStateRaw(stateDir);
        if (polled !== null) currentState = polled;
        emit({ type: "state", state: currentState }, { state: currentState });

        // The machine is the only stop arbiter. Report externally-flipped
        // status so the statusNotActive guard sees it, then exit when the
        // machine has left `running`.
        if (currentState.status !== actor.getSnapshot().context.status) {
          actor.send({ type: "STATUS_CHANGED", status: currentState.status });
        }
        if (!actor.getSnapshot().matches("running")) break;

        // Steering that arrived between iterations: queue into steering.md so
        // the next prompt's steering block picks it up.
        if (pendingSteer !== null) {
          const message = pendingSteer;
          pendingSteer = null;
          appendSteeringMessage(tasksDir, message);
          emit({ type: "steering-applied", message });
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
          typeof changeStore.listChanges === "function"
        ) {
          let stillActive = true;
          try {
            const active = await changeStore.listChanges();
            stillActive = active.includes(name);
          } catch {
            stillActive = true;
          }
          if (!stillActive) {
            info(
              `tasks.md not found and change "${name}" is no longer active — it was archived externally. Exiting.`,
            );
            currentState = {
              ...currentState,
              status: "completed",
              lastModified: new Date().toISOString(),
            };
            writeState(stateDir, currentState);
            emit({ type: "state", state: currentState }, { state: currentState });
            actor.send({ type: "ALL_TASKS_DONE", uncommittedEdits: false });
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
          info(parts.join(" · "));
        }
        const missionDone = tasksContent !== null && allTasksCompleted(tasksContent);
        const agentDone = agentTasksContent === null || allTasksCompleted(agentTasksContent);
        if (missionDone && agentDone && tasksContent !== null) {
          // --- Self-review gate (when enabled) ---
          if (options.reviewPhase?.enabled) {
            const reviewPhase = options.reviewPhase;
            const reviewFindingsPath = join(tasksDir, "review-findings.md");
            const findingsContent = storage.read(reviewFindingsPath);
            const openCount = findingsContent !== null ? countOpenFindings(findingsContent) : -1;
            const capReached = currentState.reviewRounds >= reviewPhase.maxRounds;

            if (!capReached && (findingsContent === null || openCount > 0)) {
              const roundNum = currentState.reviewRounds + 1;
              info(`Running self-review pass ${roundNum}/${reviewPhase.maxRounds}…`);

              const reviewPrompt = [
                "# Self-Review Pass",
                "",
                `You are a fresh reviewer for change \`${name}\`. Your sole task is to audit the implementation.`,
                "",
                "1. Read `proposal.md` and `design.md` from `openspec/changes/" + name + "/`.",
                "2. Run `git diff main` (or the base branch) to see all changes.",
                "3. Check the diff against the acceptance criteria in `proposal.md`.",
                `4. Write findings to \`${reviewFindingsPath}\`:`,
                "   - If issues found: `- [ ] <finding>` under `## Open`.",
                "   - If no issues: `(no findings — close round)` under `## Open`.",
                "",
                "Do not implement any fixes. Only write the findings file.",
              ].join("\n");

              await runEngine({
                engine,
                model: reviewPhase.reviewerModel ?? model,
                prompt: reviewPrompt,
                logFlag: options.log ?? false,
                logFile: join(stateDir, `log-review-${roundNum}.json`),
                taskDir: tasksDir,
                cwd: getLayout().root,
                reviewerContextStrategy: reviewPhase.reviewerContextStrategy ?? "fresh",
                onFeedEvent,
                ...(deps.agent ? { agent: deps.agent } : {}),
              });

              const updatedContent = storage.read(reviewFindingsPath);
              const newOpenCount = updatedContent !== null ? countOpenFindings(updatedContent) : 0;

              currentState = updateState(stateDir, (s) => ({
                ...s,
                reviewRounds: s.reviewRounds + 1,
                lastModified: new Date().toISOString(),
              }));
              emit({ type: "state", state: currentState }, { state: currentState });

              const newCapReached = currentState.reviewRounds >= reviewPhase.maxRounds;
              const roundResult: ReviewRoundResult = {
                openFindings: newOpenCount,
                roundNumber: currentState.reviewRounds,
                capReached: newCapReached,
                findingsContent: updatedContent,
              };
              emit({ type: "review-round", result: roundResult });
              await options.onReviewRound?.(roundResult);

              if (newOpenCount > 0 && !newCapReached) {
                info(`Review found ${newOpenCount} finding(s) — looping back for a fix cycle.`);
                continue;
              }
              if (newCapReached && newOpenCount > 0) {
                info(
                  `Review cap reached with ${newOpenCount} open finding(s) — proceeding to done.`,
                );
              } else {
                info("Self-review passed — no open findings.");
              }
            }
          }

          // --- Archive guard: refuse to archive on a dirty worktree ---
          // LIT-303 incident: when a resumed run found `tasks.md` fully
          // checked off but the worker had exited with uncommitted edits,
          // the loop archived the change and the work was stranded with
          // no PR. Refuse archiving and stop the loop so a human can either
          // commit the work or reset tasks.md to re-trigger iteration.
          const uncommitted = git.getUncommittedFiles();
          if (uncommitted.length > 0) {
            const preview = uncommitted.slice(0, 10).join("\n  ");
            const more =
              uncommitted.length > 10 ? `\n  ... and ${uncommitted.length - 10} more` : "";
            info(
              `All tasks checked off but worktree has ${uncommitted.length} uncommitted file(s) — refusing to archive. Commit or reset to resume.\n  ${preview}${more}`,
            );
            actor.send({ type: "ALL_TASKS_DONE", uncommittedEdits: true });
            break;
          }

          // --- Archive ---
          info("All tasks completed — archiving change.");
          currentState = {
            ...currentState,
            status: "completed",
            lastModified: new Date().toISOString(),
          };
          writeState(stateDir, currentState);
          emit({ type: "state", state: currentState }, { state: currentState });
          try {
            const skipStatusCheck = currentState.validateOnComplete && !currentState.createPr;
            if (!skipStatusCheck && typeof changeStore.getStatus === "function") {
              const status = await changeStore.getStatus(name);
              if (!status.isComplete) {
                const blocked = status.artifacts
                  .filter((a) => a.status !== "done")
                  .map((a) => `${a.id}=${a.status}`)
                  .join(", ");
                info(
                  `Archive skipped: openspec status reports change incomplete (${blocked || "no artifacts"}).`,
                );
                throw new Error("openspec status: change not complete");
              }
            }
            await changeStore.archiveChange(name);
            info("Change archived.");
          } catch (err) {
            info(`Archive warning: ${err}`);
          }
          actor.send({ type: "ALL_TASKS_DONE", uncommittedEdits: false });
          break;
        }

        const localIter = actor.getSnapshot().context.iteration - startingIteration + 1;

        // Drive the worker prompt from the live OpenSpec phase. Without this,
        // `phase ?? "execute"` ran every iteration even when mission
        // artifacts (`design.md` / `tasks.md`) were missing — the worker
        // chewed on `agent-tasks.md` flow items forever and the phase
        // indicator parked on `proposal`/`design`. See routeTaskPhase tests.
        const proposalContent = storage.read(join(tasksDir, "proposal.md"));
        const designContent = storage.read(join(tasksDir, "design.md"));
        const routedPhase = routeTaskPhase(options.phase, {
          proposal: proposalContent,
          design: designContent,
          tasks: tasksContent,
        });

        emit({
          type: "iteration-started",
          iteration: localIter,
          totalIteration: currentState.iteration + 1,
          phase: routedPhase,
        });
        info(`Iteration ${localIter} (total: ${currentState.iteration})`);

        const iterationPrompt = buildPhasePrompt(
          routedPhase,
          currentState,
          tasksDir,
          options.reviewPhase,
          {
            ...options.metaPrompt,
            ...(tasksContent !== null ? { tasksContent } : {}),
          },
        );

        const iterStart = new Date().toISOString();
        try {
          // Set up abort controller for live steering
          const controller = new AbortController();
          engineController = controller;
          pendingSteer = null;

          let engineResult = await runEngine({
            engine,
            model,
            prompt: iterationPrompt,
            logFlag: options.log ?? false,
            logFile: join(stateDir, "log.json"),
            taskDir: tasksDir,
            cwd: getLayout().root,
            interactive: false,
            onFeedEvent,
            signal: controller.signal,
            ...(deps.agent ? { agent: deps.agent } : {}),
          });

          // Handle live steering: kill → resume with steering message
          while (!cancelled && pendingSteer !== null && engineResult.sessionId) {
            const steerMessage = pendingSteer;
            pendingSteer = null;

            appendSteeringMessage(tasksDir, steerMessage);
            emit({ type: "steering-applied", message: steerMessage });
            info(`Live steering: ${steerMessage}`);

            // Resume the session with the steering message
            const resumeController = new AbortController();
            engineController = resumeController;

            // Filter out session init events on resume — they're noise
            const onResumeFeedEvent = (event: FeedEvent) => {
              if (event.type === "session" || event.type === "session-unknown") return;
              onFeedEvent(event);
            };

            const resumeResult = await runEngine({
              engine,
              model,
              prompt: buildSteeringPrompt(steerMessage),
              logFlag: options.log ?? false,
              logFile: join(stateDir, "log.json"),
              taskDir: tasksDir,
              cwd: getLayout().root,
              onFeedEvent: onResumeFeedEvent,
              signal: resumeController.signal,
              resumeSessionId: engineResult.sessionId,
              ...(deps.agent ? { agent: deps.agent } : {}),
            });

            resumeResult.usage = mergeUsage(engineResult.usage, resumeResult.usage);
            engineResult = resumeResult;
          }

          engineController = null;

          // A cancelled engine run is a partial iteration — do not record it.
          if (cancelled) break;

          if (engineResult.exitCode !== 0) {
            const failure = handleEngineFailure(engineResult.exitCode);
            info(failure.message);

            const result = `failed:exit-${engineResult.exitCode}` as const;
            currentState = updateStateIteration(
              stateDir,
              result,
              iterStart,
              engine,
              model,
              engineResult.usage,
            );
            emit({ type: "iteration-finished", iteration: localIter, result });

            // Stop immediately on rate limits or fatal engine errors
            if (failure.shouldStop || engineResult.rateLimited) {
              getProcessBus().emit({
                type: "loop.engine_rate_limited",
                exit_code: engineResult.exitCode,
                iteration: localIter,
              });
              actor.send({ type: "RATE_LIMITED" });
              break;
            }

            actor.send({ type: "ITERATION_FAILED" });
            getProcessBus().emit({
              type: "loop.iteration_failed",
              exit_code: engineResult.exitCode,
              iteration: localIter,
              consecutive_failures: actor.getSnapshot().context.consecutiveFailures,
            });

            continue;
          }

          // Guard: usage-limit result-error exits cleanly (exit 0) but sets rateLimited.
          // The failure block above only runs on non-zero exits, so this catches the gap.
          if (engineResult.rateLimited) {
            info("Usage limit reached — stopping loop.");
            currentState = updateStateIteration(
              stateDir,
              "failed:rate-limited",
              iterStart,
              engine,
              model,
              engineResult.usage,
            );
            emit({
              type: "iteration-finished",
              iteration: localIter,
              result: "failed:rate-limited",
            });
            getProcessBus().emit({
              type: "loop.engine_rate_limited",
              exit_code: 0,
              iteration: localIter,
            });
            actor.send({ type: "RATE_LIMITED" });
            break;
          }

          // Success
          currentState = updateStateIteration(
            stateDir,
            "success",
            iterStart,
            engine,
            model,
            engineResult.usage,
          );
          actor.send({ type: "ITERATION_DONE", costDeltaUsd: engineResult.usage?.cost_usd ?? 0 });
          emit({ type: "state", state: currentState }, { state: currentState });
          emit({ type: "iteration-finished", iteration: localIter, result: "success" });

          try {
            git.push();
          } catch {
            // Push failures are non-fatal
          }

          const stopSignal = checkStopSignal(tasksDir, stateDir);
          if (stopSignal) {
            info(`STOP signal: ${stopSignal.trim()}`);
            runnerStop = "signal";
            break;
          }

          info(`Completed iteration ${localIter}`);

          // Delay between iterations
          if (actor.getSnapshot().matches("running") && delaySeconds > 0) {
            info(`Sleeping ${delaySeconds}s before next iteration...`);
            await sleep(delaySeconds);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          info(`Engine error: ${err}`);
          getProcessBus().emit({ type: "loop.engine_error", iteration: localIter, error: message });
          runnerStop = "error";
          break;
        }
      }

      actor.stop();

      currentState = ensureState(stateDir);

      const finalIter = actor.getSnapshot().context.iteration - startingIteration;
      const machineReason = stoppedStateToReason(actor.getSnapshot());
      const reason: LoopRunnerStopReason = machineReason ?? runnerStop ?? "cancelled";

      getProcessBus().emit({
        type: "loop.task_stopped",
        stop_reason: machineReason,
        iterations: finalIter,
        total_cost_usd: currentState.usage.total_cost_usd,
        total_duration_ms: now() - loopStartTime,
        engine,
        model,
      });

      info(`Ralph loop finished after ${finalIter} iterations.`);

      if (finalIter > 0) {
        git.commitTaskDir(tasksDir, `change ${name} finished`);
        try {
          git.push();
        } catch {
          // Push failures are non-fatal
        }
      }

      emit(
        { type: "stopped", reason, iterations: finalIter },
        { state: currentState, isRunning: false, stopReason: reason },
      );
      return reason;
    });
  }

  return {
    start() {
      startPromise ??= run();
      return startPromise;
    },

    cancel() {
      if (cancelled) return;
      cancelled = true;
      engineController?.abort();
    },

    steer(message: string) {
      pendingSteer = message;
      engineController?.abort();
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
