import { serializeOverrides } from "@ralphy/config/serialize-overrides";
import type { AgentParsedArgs } from "../../../cli";
import type { RalphyConfig } from "../../config";
import type { TrackedIssue } from "@ralphy/tracker";
import type { QueueTrigger } from "../../coordinator";
import {
  type PostTaskInput,
  type PostTaskPhase,
  type PostTaskMode,
  type RetroDispositionInfo,
} from "../../post-task";

/**
 * Decide the retrospective dep handed to `runPostTask`. The hook is wired only
 * when `--agent-debug` is set; otherwise an empty object is returned so the dep
 * is omitted entirely (zero cost on normal runs). Exported for unit testing the
 * wiring decision in isolation.
 */
export function retroDepEntry(
  agentDebug: boolean,
  hook: (info: RetroDispositionInfo) => Promise<void>,
): { runRetrospective?: (info: RetroDispositionInfo) => Promise<void> } {
  return agentDebug ? { runRetrospective: hook } : {};
}

/**
 * Decide whether the exit handler should open a PR. A PR is wanted only when
 * the base intent is set (`--create-pr` / `createPrOnSuccess`) and the change
 * is not parked awaiting a human — either reaped into `awaitingChangeSet` or
 * flagged by the coordinator's `isAwaitingConfirmation`. Pure; exported for
 * unit testing the decision in isolation.
 */
export function computeWantPr(
  wantPrBase: boolean,
  isAwaiting: boolean,
  isAwaitingConfirmation: boolean,
): boolean {
  return wantPrBase && !isAwaiting && !isAwaitingConfirmation;
}

/**
 * Decide whether the exit handler should run validate-only post-task. True
 * only when the worker dropped a `specs/validate.md` and there is no PR intent
 * (a PR run supersedes a validate-only run). Pure; exported for unit testing.
 */
export function computeWantValidateOnly(hasValidateSpec: boolean, wantPrBase: boolean): boolean {
  return hasValidateSpec && !wantPrBase;
}

/** The four per-change maps the wire layer threads into each spawn worker. */
export interface WorkerChangeMaps {
  cwdByChange: Map<string, string>;
  statesDirByChange: Map<string, string>;
  branchByChange: Map<string, string>;
  issueByChange: Map<string, TrackedIssue>;
}

/**
 * Release every per-change map entry for a finished change. Centralizes the
 * four `.delete(changeName)` calls so the exit handler can't drift out of sync
 * (e.g. add a fifth map and forget one). Exported for unit testing.
 */
export function releaseWorkerMaps(maps: WorkerChangeMaps, changeName: string): void {
  maps.cwdByChange.delete(changeName);
  maps.statesDirByChange.delete(changeName);
  maps.branchByChange.delete(changeName);
  maps.issueByChange.delete(changeName);
}

/**
 * Build the `ralph loop task …` argv for a worker subprocess.
 *
 * The child receives the user's sparse CLI overrides
 * (`serializeOverrides(args.overrides)`) plus an explicit `--workflow` path,
 * never pre-merged effective values: it re-runs the shared config resolution
 * against the SAME WORKFLOW.md, so parent and child apply `cli > workflow >
 * default` precedence through one code path. Config-only settings (limits the
 * user did not pass, review phase, …) reach the worker through the
 * re-resolution, not through argv. The `--workflow` flag pins the main
 * checkout's file so a worktree cwd cannot drift the worker's config. The
 * argv always terminates with `--from-agent`.
 *
 * Recovery spawns (`ci-fix` / `conflict-fix`) additionally carry `--trigger`
 * so the worker's config resolution picks the per-flow model/effort
 * (`prRecovery.ciFix*` / `prRecovery.conflictFix*`). Other triggers (fresh,
 * resume, review) use the top-level model and pass nothing.
 */
export function buildTaskCmd(
  args: AgentParsedArgs,
  changeName: string,
  workflowFilePath: string,
  trigger?: QueueTrigger,
): string[] {
  return [
    process.execPath,
    process.argv[1] ?? "",
    "loop",
    "task",
    "--name",
    changeName,
    ...serializeOverrides(args.overrides),
    "--workflow",
    workflowFilePath,
    ...(trigger === "ci-fix" || trigger === "conflict-fix" ? ["--trigger", trigger] : []),
    "--from-agent",
  ];
}

/**
 * Map worker state + config into the `PostTaskInput` handed to `runPostTask`.
 * Owns the large `cfg: { … validateCommands }` block (the flag-wiring most
 * prone to the RLF-204 class of bug) and the conditional `mode`/`prUrl` keys.
 * Pure and exported so the mapping is asserted with plain object equality, with
 * no subprocess or network.
 */
export function buildPostTaskInput(input: {
  args: AgentParsedArgs;
  cfg: RalphyConfig;
  changeName: string;
  cwd: string;
  projectRoot: string;
  changeDir: string;
  stateFilePath: string;
  branch: string | null;
  issue: TrackedIssue | null;
  exitCode: number;
  useWorktree: boolean;
  wantPr: boolean;
  wantAutoMerge: boolean;
  wantValidateOnly: boolean;
  trigger?: QueueTrigger;
  prUrl?: string;
  respawnWorker: () => Promise<number>;
}): PostTaskInput {
  const { cfg } = input;
  return {
    ...(input.trigger ? { mode: input.trigger as PostTaskMode } : {}),
    ...(input.prUrl ? { prUrl: input.prUrl } : {}),
    changeName: input.changeName,
    cwd: input.cwd,
    projectRoot: input.projectRoot,
    changeDir: input.changeDir,
    stateFilePath: input.stateFilePath,
    branch: input.branch,
    issue: input.issue,
    exitCode: input.exitCode,
    useWorktree: input.useWorktree,
    wantPr: input.wantPr,
    wantAutoMerge: input.wantAutoMerge,
    wantValidateOnly: input.wantValidateOnly,
    cfg: {
      teardownScript: cfg.teardownScript ?? null,
      prBaseBranch: cfg.prBaseBranch,
      autoMergeStrategy: cfg.autoMergeStrategy,
      cleanupWorktreeOnSuccess: cfg.cleanupWorktreeOnSuccess,
      stackPrsOnDependencies: cfg.stackPrsOnDependencies,
      neverTouch: cfg.boundaries.never_touch,
      metaOnlyFiles: cfg.boundaries.meta_only_files,
      finalizeNoOpAsDone: cfg.finalizeNoOpAsDone,
      manualMergeWhenAutoMergeDisabled: cfg.manualMergeWhenAutoMergeDisabled,
      prDraft: cfg.prDraft,
      prLabels: cfg.prLabels,
      validateCommands: [
        cfg.commands.test,
        cfg.commands.lint,
        cfg.commands.typecheck,
        cfg.commands.structure,
      ].filter((c): c is string => Boolean(c)),
    },
    respawnWorker: input.respawnWorker,
  };
}

export type WorkerPhase = PostTaskPhase | "working" | "scaffolding";
