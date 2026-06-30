import { join } from "node:path";
import { createActor } from "xstate";
import type { Engine, State } from "@ralphy/types";
import type { FeedEvent } from "@ralphy/engine/feed-events";
import { runEngine, handleEngineFailure } from "@ralphy/engine/engine";
import { getLayout, getStorage } from "@ralphy/context";
import { getProcessBus } from "@ralphy/events";
import { writeState, updateState, ensureState, tryReadStateRaw } from "../state";
import { countOpenFindings, deriveOpenSpecPhase } from "../openspec/phase";
import { excludeFrameworkOwnedPaths } from "../git";
import { loopMachine, stoppedStateToReason } from "../machines";
import { buildPhasePrompt, routeTaskPhase } from "../loop/task-prompts";
import {
  updateStateIteration,
  checkStopSignal,
  appendSteeringMessage,
  buildSteeringPrompt,
  mergeUsage,
} from "../loop/stop-and-state";
import {
  allTasksCompleted,
  countUncheckedTasks,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
  type LoopChangeStore,
  type ReviewRoundResult,
} from "../loop";
import type {
  LoopRunnerStopReason,
  LoopRunnerOptions,
  LoopRunnerDeps,
  LoopRunnerGit,
  LoopRunnerEvent,
  LoopRunnerSnapshot,
} from "./index";

type LoopActor = ReturnType<typeof createActor<typeof loopMachine>>;

/**
 * Mutable signals shared between the runner's public command surface
 * (`cancel`/`steer`) and the iteration loop. Holding them on one object keeps
 * the by-reference mutations visible across the extracted loop boundary.
 */
export interface RunnerSignals {
  engineController: AbortController | null;
  pendingSteer: string | null;
  cancelled: boolean;
}

/**
 * Everything the iteration loop needs from `createLoopRunner`. The loop body
 * was lifted out of the closure verbatim; this context carries the config,
 * services, machine actor, shared signals, and emit helpers it used to read
 * directly from the closure scope.
 */
export interface LoopExecutionContext {
  name: string;
  engine: Engine;
  model: string;
  effort: string | undefined;
  planModel: string | undefined;
  planEffort: string | undefined;
  delaySeconds: number;
  options: LoopRunnerOptions;
  deps: LoopRunnerDeps;
  changeStore: LoopChangeStore;
  git: LoopRunnerGit;
  sleep: (seconds: number) => Promise<void>;
  now: () => number;
  storage: ReturnType<typeof getStorage>;
  stateDir: string;
  tasksDir: string;
  actor: LoopActor;
  startingIteration: number;
  loopStartTime: number;
  signals: RunnerSignals;
  currentState: State;
  emit: (event: LoopRunnerEvent, patch?: Partial<LoopRunnerSnapshot>) => void;
  info: (text: string) => void;
  onFeedEvent: (event: FeedEvent) => void;
}

/**
 * Drives the iteration loop to a machine-stopped state, then finalizes state,
 * emits the terminal `stopped` event, and resolves with the stop reason. This
 * is the body of `createLoopRunner`'s `run()` past initial state setup; the
 * machine actor remains the only stop arbiter.
 */
export async function executeLoop(context: LoopExecutionContext): Promise<LoopRunnerStopReason> {
  const {
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
    actor,
    startingIteration,
    loopStartTime,
    signals,
    emit,
    info,
    onFeedEvent,
  } = context;
  let currentState = context.currentState;

  // Stops the runner itself decides (the machine cannot express these).
  let runnerStop: "signal" | "error" | null = null;

  while (!signals.cancelled) {
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
    if (signals.pendingSteer !== null) {
      const message = signals.pendingSteer;
      signals.pendingSteer = null;
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

          const reviewEffort = reviewPhase.reviewerEffort ?? effort;
          await runEngine({
            engine,
            model: reviewPhase.reviewerModel ?? model,
            ...(reviewEffort !== undefined ? { effort: reviewEffort } : {}),
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
            info(`Review cap reached with ${newOpenCount} open finding(s) — proceeding to done.`);
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
      const uncommitted = excludeFrameworkOwnedPaths(git.getUncommittedFiles());
      if (uncommitted.length > 0) {
        const preview = uncommitted.slice(0, 10).join("\n  ");
        const more = uncommitted.length > 10 ? `\n  ... and ${uncommitted.length - 10} more` : "";
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
      const skipStatusCheck = currentState.validateOnComplete && !currentState.createPr;
      let archiveBlocked = false;
      if (!skipStatusCheck && typeof changeStore.getStatus === "function") {
        const status = await changeStore.getStatus(name);
        if (!status.isComplete) {
          const blocked = status.artifacts
            .filter((a) => a.status !== "done")
            .map((a) => `${a.id}=${a.status}`)
            .join(", ");
          // Expected skip — not a failure. Log and fall through to
          // ALL_TASKS_DONE without entering the failure path.
          info(
            `Archive skipped: openspec status reports change incomplete (${blocked || "no artifacts"}).`,
          );
          archiveBlocked = true;
        }
      }
      if (!archiveBlocked) {
        try {
          await changeStore.archiveChange(name);
          info("Change archived.");
        } catch (err) {
          // A genuine archive failure must be visible and name the change
          // so the backlog never accumulates silently (RLF-251).
          const message = err instanceof Error ? err.message : String(err);
          info(`Archive failed for "${name}": ${message}`);
        }
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

    // Planning phases (proposal/design/tasks) can run a dedicated
    // model/effort; the implement phase always uses the top-level model.
    // routeTaskPhase collapses tasks→execute, so derive the OpenSpec phase
    // directly to keep all three planning phases on the plan model.
    const ospPhase = deriveOpenSpecPhase({
      proposal: proposalContent,
      design: designContent,
      tasks: tasksContent,
      reviewFindings: null,
      reviewRounds: 0,
      maxReviewRounds: 0,
    });
    const isPlanningPhase =
      ospPhase === "proposal" || ospPhase === "design" || ospPhase === "tasks";
    const iterModel = isPlanningPhase ? (planModel ?? model) : model;
    const iterEffort = isPlanningPhase ? (planEffort ?? effort) : effort;

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
      signals.engineController = controller;
      signals.pendingSteer = null;

      let engineResult = await runEngine({
        engine,
        model: iterModel,
        ...(iterEffort !== undefined ? { effort: iterEffort } : {}),
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
      while (!signals.cancelled && signals.pendingSteer !== null && engineResult.sessionId) {
        const steerMessage = signals.pendingSteer;
        signals.pendingSteer = null;

        appendSteeringMessage(tasksDir, steerMessage);
        emit({ type: "steering-applied", message: steerMessage });
        info(`Live steering: ${steerMessage}`);

        // Resume the session with the steering message
        const resumeController = new AbortController();
        signals.engineController = resumeController;

        // Filter out session init events on resume — they're noise
        const onResumeFeedEvent = (event: FeedEvent) => {
          if (event.type === "session" || event.type === "session-unknown") return;
          onFeedEvent(event);
        };

        const resumeResult = await runEngine({
          engine,
          model: iterModel,
          ...(iterEffort !== undefined ? { effort: iterEffort } : {}),
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

      signals.engineController = null;

      // A cancelled engine run is a partial iteration — do not record it.
      if (signals.cancelled) break;

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
}
