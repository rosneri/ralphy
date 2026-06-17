import type { TrackedIssue } from "@ralphy/tracker";
import type { GitRunner } from "../worktree";
import type { CmdRunner } from "../pr";
import type { CodeHost } from "@ralphy/codehost";
import type { DependencyBase } from "../wire/pr-helpers";
import { registry as featureRegistry } from "../../features/registry";
import { runFeaturePostTask } from "../../features/run-feature";
import type { FeatureCtx } from "../../features/types";

import {
  NO_CHANGES_EXIT,
  summarizeUncommittedStatus,
  type PostTaskInput,
  type PostTaskMode,
  type PostTaskPhase,
  type RetroDispositionInfo,
} from "./types";
import { runPrPhase } from "./pr-phase";
import { runConflictFixVerify } from "./conflict-fix-verify";
import { runValidateOnlyPhase } from "./validate-only";
import { runWorktreeCleanupPhase } from "./cleanup";
import { runTeardownPhase } from "./teardown";

// Public surface re-exported so `../agent/post-task` consumers (tests, the
// wire layer, worker-pool) keep importing these from the package root.
export {
  NO_CHANGES_EXIT,
  summarizeUncommittedStatus,
  runPrPhase,
  runValidateOnlyPhase,
  runWorktreeCleanupPhase,
  runTeardownPhase,
  type PostTaskInput,
  type PostTaskMode,
  type PostTaskPhase,
  type RetroDispositionInfo,
};

interface PostTaskDeps {
  cmd: CmdRunner;
  git: GitRunner;
  codeHost: CodeHost;
  log: (text: string, color?: string) => void;
  /**
   * Optional opt-in (`--agent-debug`): run a one-shot retrospective self-review
   * after the ticket reaches its terminal disposition and before worktree
   * cleanup (so the worktree artifacts are still readable). The dep owns its
   * own error isolation and must never throw. Omitted on normal runs.
   */
  runRetrospective?: (info: RetroDispositionInfo) => Promise<void>;
  /** Run a shell command and surface non-zero exit via `log`, never throw. */
  runScript: (label: string, cmd: string, cwd: string) => Promise<void>;
  /** Optional: record the URL of the PR opened (or surfaced) for this
   *  changeName. Used by the agent coordinator's conflict-scan to know
   *  which changes to check for merge conflicts on subsequent polls. */
  registerPr?: (changeName: string, prUrl: string) => void;
  /** Optional: apply the additive `setPrReady` Linear marker at the PR-phase
   *  success point. Forwarded into `runPrPhase`. See PrPhaseDeps for the skip
   *  rule and failure-isolation contract. */
  onPrReady?: (prUrl: string) => Promise<void>;
  /** Optional phase emitter — surfaced in the dashboard footer. */
  onPhase?: (phase: PostTaskPhase, detail?: string) => void;
  /** Optional: resolve the blocker PR a stacked PR should base on. See
   *  PrPhaseDeps for details. */
  resolveDependencyBaseBranch?: (issue: TrackedIssue) => Promise<DependencyBase | null>;
  /** Optional: build the per-issue `FeatureCtx` consumed by the feature
   *  registry walk. When provided, `runPostTask` iterates the registry and
   *  invokes `feature.postTask?.(...)` on each entry alongside the legacy
   *  phases. Stub features have no `postTask`, so this dispatch is a no-op
   *  until a slice migrates. Omitted in today's wire layer; the legacy
   *  phases still own the full post-task flow in that case. */
  buildFeatureCtx?: (issue: TrackedIssue) => FeatureCtx | null;
  /**
   * Override the backoff schedule (ms) for the conflict-fix verify path's
   * UNKNOWN-mergeability polling. Default is the shared
   * `DEFAULT_BACKOFFS_MS` (~31s total). Tests pass `[0, 0, 0]` to keep
   * the historical 3-retry contract instant.
   */
  _mergeabilityBackoffsMs?: number[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Orchestrate everything that happens after the worker subprocess exits.
 * The flow mirrors the agent mode diagram exactly:
 *
 *  Phase 1 (PR) — on success + `wantPr`: push, open/surface a PR, then run
 *    the conflict + CI fix loop until checks are green or attempts run out.
 *  Phase 2 (cleanup) — on success + `useWorktree`: safely remove the worktree.
 *  Phase 3 (teardown) — always: run `teardownScript` if configured.
 *
 * Returns an "effective" exit code: the worker's own code, overridden to
 * `PR_FAILED_EXIT` or `CI_FAILED_EXIT` when post-task work fails. The
 * coordinator uses this to decide whether to mark the issue processed.
 */
export async function runPostTask(input: PostTaskInput, deps: PostTaskDeps): Promise<number> {
  const { log, cmd, git, codeHost, runScript } = deps;
  const emit = (phase: PostTaskPhase, detail?: string) => deps.onPhase?.(phase, detail);
  const {
    changeName,
    cwd,
    projectRoot,
    changeDir,
    stateFilePath,
    branch,
    issue,
    exitCode,
    useWorktree,
    wantPr,
    wantAutoMerge,
    wantValidateOnly,
    cfg,
    respawnWorker,
  } = input;

  // All terminal paths below set `effectiveCode` and return through the single
  // `finally`, which runs worktree cleanup + teardown EXACTLY ONCE for every
  // outcome — success, PR-failed, no-changes, validate-only, conflict-fix, and
  // the throw path (the `finally` fires even when a phase throws). Cleanup reads
  // `effectiveCode`, so a path that fails the iteration only needs to set it
  // (e.g. the conflict-fix unpushed guard → PR_FAILED_EXIT) to preserve the
  // "keep the worktree on failure" guarantee.
  let effectiveCode = exitCode;
  try {
    // Registry walk: let per-feature slices run their post-task tail
    // alongside the legacy phases. Stub features have no `postTask`, so
    // this is a no-op until a slice migrates. Walk runs even when the
    // worker exited non-zero so failure-handling slices (e.g. stuck) can
    // see the exit code.
    if (deps.buildFeatureCtx && issue) {
      const ctx = deps.buildFeatureCtx(issue);
      if (ctx) {
        const result = { exitCode, branch };
        for (const feature of featureRegistry) {
          await runFeaturePostTask(feature, ctx, result);
        }
      }
    }

    // Ordered phase pipeline. Each handler guards on the current
    // `effectiveCode`; the orchestrator runs the first whose guard matches.
    // A `terminal: true` handler owns its own done/gave-up emit and
    // short-circuits the shared success tail; the non-terminal PR handler
    // falls through to the tail, which emits the disposition and runs the
    // retrospective. Exactly one handler can apply because validate-only and
    // conflict-fix both require `effectiveCode === 0` and the worker mode/flags
    // are mutually exclusive.
    interface PhaseResult {
      effectiveCode: number;
      terminal: boolean;
    }

    const phases: { applies: boolean; run: () => Promise<PhaseResult> }[] = [
      {
        // Validate-only: run check commands + inject the openspec validation
        // task instead of creating a PR. Emits its own disposition.
        applies: wantValidateOnly === true && effectiveCode === 0,
        run: async () => {
          const code = await runValidateOnlyPhase(
            {
              changeName,
              changeDir,
              stateFilePath,
              validateCommands: cfg.validateCommands ?? [],
              cwd,
            },
            { log, emit, respawnWorker },
          );
          emit(code === 0 ? "done" : "gave-up", code !== 0 ? `exit ${code}` : undefined);
          return { effectiveCode: code, terminal: true };
        },
      },
      {
        // RLF-82 conflict-fix verify-only short-circuit. Emits its own
        // disposition (done, or gave-up on an unpushed resolution).
        applies: input.mode === "conflict-fix" && effectiveCode === 0,
        run: async () => {
          const code = await runConflictFixVerify(
            {
              identifier: issue?.identifier ?? changeName,
              cwd,
              branch,
              prUrl: input.prUrl ?? null,
            },
            {
              cmd,
              codeHost,
              log,
              emit,
              ...(deps._mergeabilityBackoffsMs !== undefined
                ? { mergeabilityBackoffsMs: deps._mergeabilityBackoffsMs }
                : {}),
            },
          );
          return { effectiveCode: code, terminal: true };
        },
      },
      {
        // Phase 1: PR creation. Non-terminal — falls through to the shared
        // success tail (disposition emit + retrospective).
        applies: effectiveCode === 0 && wantPr,
        run: async () => {
          const code = await runPrPhase(
            { changeName, cwd, branch, changeDir, stateFilePath, issue, wantAutoMerge, cfg },
            {
              cmd,
              codeHost,
              log,
              emit,
              respawnWorker,
              ...(deps.registerPr !== undefined ? { registerPr: deps.registerPr } : {}),
              ...(deps.onPrReady !== undefined ? { onPrReady: deps.onPrReady } : {}),
              ...(deps.resolveDependencyBaseBranch !== undefined
                ? { resolveDependencyBaseBranch: deps.resolveDependencyBaseBranch }
                : {}),
            },
          );
          return { effectiveCode: code, terminal: false };
        },
      },
    ];

    // A non-zero exit with `wantPr` skips the PR phase (no handler applies
    // because the PR guard requires `effectiveCode === 0`); surface why.
    if (effectiveCode !== 0 && wantPr) {
      log(
        `  skipping PR phase for ${changeName} (worker exited with code ${effectiveCode})`,
        "gray",
      );
    }

    for (const phase of phases) {
      if (!phase.applies) continue;
      const result = await phase.run();
      effectiveCode = result.effectiveCode;
      if (result.terminal) return effectiveCode;
      break; // the non-terminal PR phase ran; fall through to the shared tail
    }

    // Shared success tail — runs for the main PR path and the no-PR /
    // non-zero fall-through. NO_CHANGES_EXIT is a successful "nothing to ship"
    // outcome, not a failure: surface it as done on the dashboard.
    const succeeded = effectiveCode === 0 || effectiveCode === NO_CHANGES_EXIT;
    emit(succeeded ? "done" : "gave-up", succeeded ? undefined : `exit ${effectiveCode}`);

    // Retrospective (opt-in, --agent-debug): runs before worktree cleanup so the
    // worktree artifacts + state file are still readable. The dep never throws;
    // `effectiveCode` is left unchanged. Reached only on the shared tail — the
    // validate-only and conflict-fix terminals return above without it.
    await deps.runRetrospective?.({
      changeName,
      cwd,
      changeDir,
      stateFilePath,
      branch,
      issue,
      effectiveCode,
    });

    return effectiveCode;
  } finally {
    // Phase 2 (cleanup) + Phase 3 (teardown) — run once for every terminal
    // outcome, including the throw path.
    await runWorktreeCleanupPhase(
      { changeName, cwd, projectRoot, useWorktree, effectiveCode, cfg },
      { git, log, emit },
    );
    await runTeardownPhase({ cwd, teardownScript: cfg.teardownScript }, { runScript, log, emit });
  }
}
