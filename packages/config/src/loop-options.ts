import type { WorkflowConfig } from "@ralphy/workflow";
import type { LoopChangeStore, LoopOptions, MetaPromptOptions, TaskPhase } from "@ralphy/core/loop";

/** Sparse review-phase overrides from the bespoke `--review-*` CLI flags. */
export interface ReviewPhaseOverrides {
  enabled?: boolean;
  maxRounds?: number;
  reviewerModel?: string;
  reviewerEffort?: string;
  reviewerContextStrategy?: "fresh" | "warm";
}

/** Per-task runtime injections — everything `LoopOptions` needs beyond config. */
export interface LoopRuntime {
  name: string;
  prompt: string;
  changeStore: LoopChangeStore;
  phase?: TaskPhase;
  createPr?: boolean;
  prDraft?: boolean;
  onReviewRound?: LoopOptions["onReviewRound"];
  metaPrompt?: MetaPromptOptions;
  /** Bespoke `--review-*` CLI flags — sparse, overlaid onto the workflow's
   *  `openspec.reviewPhase` block with the same presence-based precedence as
   *  every other override. */
  reviewPhase?: ReviewPhaseOverrides;
  /** Recovery flow this worker serves (`--trigger`, set by the agent's
   *  fix-worker spawns). Selects the per-flow model/effort from
   *  `prRecovery.{ciFix,conflictFix}{Model,Effort}`, falling back to the
   *  top-level `model`/`effort`. */
  trigger?: "ci-fix" | "conflict-fix";
}

/**
 * Assemble `LoopOptions` from an effective config plus runtime injections —
 * the one place this wiring exists, so callers cannot hand-wire it wrong.
 */
export function loopOptionsFromConfig(
  effective: WorkflowConfig,
  runtime: LoopRuntime,
): LoopOptions {
  const configReview = effective.openspec.reviewPhase;
  const overlay = runtime.reviewPhase ?? {};
  const reviewEnabled = overlay.enabled ?? configReview.enabled;
  const reviewerModel = overlay.reviewerModel ?? configReview.reviewerModel;
  const reviewerEffort = overlay.reviewerEffort ?? configReview.reviewerEffort;
  const reviewPhase = reviewEnabled
    ? {
        enabled: true,
        maxRounds: overlay.maxRounds ?? configReview.maxRounds,
        reviewerContextStrategy:
          overlay.reviewerContextStrategy ?? configReview.reviewerContextStrategy,
        ...(reviewerModel !== undefined ? { reviewerModel } : {}),
        ...(reviewerEffort !== undefined ? { reviewerEffort } : {}),
      }
    : undefined;
  // Fix workers (`--trigger ci-fix|conflict-fix`) take their model/effort from
  // the matching prRecovery keys, falling back to the top-level values.
  const flow: { model?: string | undefined; effort?: WorkflowConfig["effort"] } =
    runtime.trigger === "ci-fix"
      ? { model: effective.prRecovery.ciFixModel, effort: effective.prRecovery.ciFixEffort }
      : runtime.trigger === "conflict-fix"
        ? {
            model: effective.prRecovery.conflictFixModel,
            effort: effective.prRecovery.conflictFixEffort,
          }
        : {};
  const effort = flow.effort ?? effective.effort;
  return {
    name: runtime.name,
    prompt: runtime.prompt,
    engine: effective.engine,
    model: flow.model ?? effective.model,
    ...(effort !== undefined ? { effort } : {}),
    ...(effective.planModel !== undefined ? { planModel: effective.planModel } : {}),
    ...(effective.planEffort !== undefined ? { planEffort: effective.planEffort } : {}),
    maxIterations: effective.maxIterationsPerTask,
    maxCostUsd: effective.maxCostUsdPerTask,
    maxRuntimeMinutes: effective.maxRuntimeMinutesPerTask,
    maxConsecutiveFailures: effective.maxConsecutiveFailuresPerTask,
    delay: effective.iterationDelaySeconds,
    log: effective.logRawStream,
    verbose: effective.taskVerbose,
    manualTest: effective.enableManualTest,
    changeStore: runtime.changeStore,
    ...(runtime.createPr !== undefined ? { createPr: runtime.createPr } : {}),
    ...(runtime.prDraft !== undefined ? { prDraft: runtime.prDraft } : {}),
    ...(runtime.phase !== undefined ? { phase: runtime.phase } : {}),
    ...(reviewPhase !== undefined ? { reviewPhase } : {}),
    ...(runtime.onReviewRound !== undefined ? { onReviewRound: runtime.onReviewRound } : {}),
    ...(runtime.metaPrompt !== undefined ? { metaPrompt: runtime.metaPrompt } : {}),
  };
}
