import { join } from "node:path";
import { resolveLinearFilter, linearFilterScope, applyAssigneeOverride } from "@ralphy/workflow";
import { createBus, subscribeAgentDiag } from "@ralphy/events";
import { PollContext } from "../shared/capabilities/poll-context";
import type { AgentParsedArgs } from "../cli";
import type { RalphyConfig } from "./config";
import { AgentCoordinator } from "./coordinator";
import type { IssueTracker, TrackedIssue } from "@ralphy/tracker";

import {
  pickOpenPrUrlFromAttachments,
  resolveDependencyBaseBranchImpl,
  createOpenDraftPr,
} from "./wire/pr-helpers";
import { bunGitRunner, bunCmdRunner, type AgentRunners } from "./wire/runners";
import { describeIndicators } from "./wire/indicators";
import { githubReactionSlug } from "./wire/task-bodies";
import { createTracker } from "./wire/tracker/create-tracker";
import { resolveTicketNumbers } from "../shared/capabilities/linear-client/ticket-identifier";
import { createGhCliCodeHost } from "@ralphy/codehost";
import { createPrepareHelpers } from "./wire/prepare";
import { createPrDiscovery } from "./wire/pr-discovery";
import { isChangeArchivedForIssue } from "./wire/mention-scan";
import { createSpawnWorker } from "./wire/spawn/worker";
import { type WorkerPhase } from "./wire/spawn/worker-helpers";
import { createBaselineGateRunner } from "./wire/baseline";
import { createCommentSyncHooks } from "./wire/comment-sync";
import {
  buildCoordinatorOptions,
  createAgentDiagnostics,
  createConfirmationCaps,
  createDefaultScriptRunner,
  createFeatureContextBuilder,
  createManualMergeFallback,
  readIterationCount,
  readTasksFingerprint,
  resolveUseWorktreeForConcurrency,
  warnWhenTargetedTicketsLackGetIndicator,
} from "./wire-coordinator-helpers";

export { pickOpenPrUrlFromAttachments, resolveDependencyBaseBranchImpl, githubReactionSlug };
export type { AgentRunners };

interface BuildAgentCoordinatorInput {
  args: AgentParsedArgs;
  cfg: RalphyConfig;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  apiKey: string;
  onLog: (text: string, color?: string) => void;
  onFileLog?: (text: string) => void;
  onWorkersChanged: () => void;
  onWorkerStarted: (
    changeName: string,
    statesDir: string,
    logFile: string,
    changeDir: string,
  ) => void;
  onWorkerExited: (changeName: string) => void;
  onWorkerPhase?: (changeName: string, phase: WorkerPhase, detail?: string) => void;
  onWorkerOutput?: (changeName: string, line: string) => void;
  onWorkerCmd?: (
    changeName: string,
    cmd: string[],
    state: "start" | "end",
    durationMs?: number,
    ok?: boolean,
  ) => void;
  onWorkerPr?: (changeName: string, prUrl: string) => void;
  onAwaitingTicket?: (info: {
    changeName: string;
    issueIdentifier: string;
    issueUrl: string;
    issueTitle: string;
    since: string | null;
    round: number;
  }) => void;
  runners?: AgentRunners;
}

interface BuildAgentCoordinatorResult {
  coord: AgentCoordinator;
  filterDesc: string;
  concurrency: number;
  pollInterval: number;
  getWorkerCwd: (changeName: string) => string | undefined;
  syncTasksEnabled: boolean;
  runBaselineGate: () => Promise<void>;
}

export function buildAgentCoordinator(
  input: BuildAgentCoordinatorInput,
): BuildAgentCoordinatorResult {
  const {
    args,
    cfg,
    projectRoot,
    statesDir,
    tasksDir,
    apiKey,
    onLog,
    onFileLog,
    onWorkersChanged,
    onWorkerStarted,
    onWorkerExited,
    onWorkerPhase,
    onWorkerOutput,
    onWorkerCmd,
    onAwaitingTicket,
  } = input;

  const logsDir = join(projectRoot, ".ralph", "logs");

  const bus = createBus();
  subscribeAgentDiag(bus, onLog);
  const diag = createAgentDiagnostics(bus);

  const concurrency = cfg.concurrency;
  const pollInterval = cfg.pollIntervalSeconds;

  const team = cfg.linear.team;
  // The global `linear.filter` (marker list of label + assignee clauses) scopes
  // every Linear query and, transitively, the GitHub PR searches rooted at those
  // issues. `--linear-assignee` overrides just the assignee clause for this run.
  const resolvedFilter = resolveLinearFilter(
    applyAssigneeOverride(cfg.linear.filter, args.linearAssignee),
  );
  const { assignee, anyAssignee, requireAllLabels } = resolvedFilter;
  const scope = linearFilterScope(resolvedFilter);

  // RLF-208: resolve --ticket tokens to a deduped set of Linear ticket numbers,
  // validated against the configured team. Throws a clean CLI error on a bare
  // number without a team or an identifier whose team disagrees.
  const ticketNumbers = resolveTicketNumbers(args.ticketTokens, team);

  const gitRunner = input.runners?.git ?? bunGitRunner;
  const cmdRunner = input.runners?.cmd ?? bunCmdRunner;

  // Per-changeName book-keeping maps shared across helpers.
  const cwdByChange = new Map<string, string>();
  const statesDirByChange = new Map<string, string>();
  const branchByChange = new Map<string, string>();
  const issueByChange = new Map<string, TrackedIssue>();
  const prByChange = new Map<string, string>();
  const stalePingedAt = new Map<string, number>();
  const lastHandledReviewActivity = new Map<string, string>();
  const awaitingChangeSet = new Set<string>();
  const coordRef: { current: AgentCoordinator | null } = { current: null };

  let pollContext = new PollContext();
  const useWorktree = resolveUseWorktreeForConcurrency(cfg.useWorktree, concurrency, diag);

  const scriptRunner = input.runners?.runScript ?? createDefaultScriptRunner(projectRoot, diag);

  // The CodeHost port (issue #403): the single gh adapter every PR mechanism
  // flows through — state probes, checks classification with the configured
  // ignore-list, merge transitions.
  const codeHost = createGhCliCodeHost({
    cmdRunner,
    cwd: projectRoot,
    ignoreChecks: cfg.prRecovery.ignoreChecks,
  });

  // PR discovery and the tracker facade reference each other lazily (the
  // Linear mention scanner resolves PR URLs through discovery; discovery reads
  // PR links recorded on the issue through the tracker). Both calls happen at
  // poll time, so a late-bound ref breaks the construction cycle.
  const trackerRef: { current: IssueTracker | null } = { current: null };

  const prDiscovery = createPrDiscovery({
    projectRoot,
    cmdRunner,
    codeHost,
    fetchPullRequestLinks: (issue) => trackerRef.current!.fetchPullRequestLinks(issue),
    onLog,
    ...(onFileLog ? { onFileLog } : {}),
    diag,
    prByChange,
    getPollContext: () => pollContext,
  });

  // The tracker bundle (issue #403): `createTracker` is the only place
  // `cfg.tracker.kind` is read. Everything backend-specific — indicators,
  // transport, mention scanning, the IssueTracker facade, comment mutations,
  // and the spec sink (RLF-239) — is selected there once.
  const {
    tracker,
    indicators,
    transport: provider,
    commentMutations,
    specSink,
    credentialsReady,
  } = createTracker({
    cfg,
    args,
    apiKey,
    projectRoot,
    useWorktree,
    cmdRunner,
    onLog,
    diag,
    team,
    assignee,
    anyAssignee,
    scope,
    ticketNumbers,
    cwdByChange,
    stalePingedAt,
    lastHandledReviewActivity,
    resolvePrUrlForIssue: prDiscovery.resolvePrUrlForIssue,
  });
  trackerRef.current = tracker;

  const mergePr = createManualMergeFallback(codeHost, cfg.autoMergeStrategy, diag);

  warnWhenTargetedTicketsLackGetIndicator(ticketNumbers, indicators, diag);

  const prep = createPrepareHelpers({
    args,
    cfg,
    projectRoot,
    statesDir,
    tasksDir,
    apiKey,
    useWorktree,
    gitRunner,
    diag,
    maps: { cwdByChange, statesDirByChange, issueByChange, branchByChange, prByChange },
    scriptRunner,
    ...(input.runners?.worktree ? { worktreeProvider: input.runners.worktree } : {}),
  });

  const spawnWorker = createSpawnWorker({
    args,
    cfg,
    apiKey,
    projectRoot,
    statesDir,
    logsDir,
    useWorktree,
    indicators,
    cmdRunner,
    gitRunner,
    codeHost,
    applyIndicator: provider.applyIndicator,
    bus,
    onLog,
    diag,
    runners: input.runners,
    awaitingChangeSet,
    coordRef,
    cwdByChange,
    statesDirByChange,
    branchByChange,
    issueByChange,
    prByChange,
    onPrRegistered: (cn, url) => {
      prByChange.set(cn, url);
      prDiscovery.clearPrUnavailable(cn);
      const issue = issueByChange.get(cn);
      if (issue) prDiscovery.invalidatePrUrlForIssue(issue.id);
      input.onWorkerPr?.(cn, url);
    },
    runScript: prep.runScript,
    onWorkerStarted,
    onWorkerExited,
    ...(onWorkerPhase ? { onWorkerPhase } : {}),
    ...(onWorkerOutput ? { onWorkerOutput } : {}),
    ...(onWorkerCmd ? { onWorkerCmd } : {}),
  });

  const openDraftPr = createOpenDraftPr({
    branchByChange,
    prByChange,
    cmdRunner,
    prBaseBranch: cfg.prBaseBranch,
    prLabels: cfg.prLabels,
    invalidatePrUrlForIssue: (issueId) => prDiscovery.invalidatePrUrlForIssue(issueId),
  });

  const confirmationCaps = createConfirmationCaps({
    cfg,
    apiKey,
    projectRoot,
    useWorktree,
    indicators,
    cwdByChange,
    awaitingChangeSet,
    coordRef,
    applyIndicator: provider.applyIndicator,
    applyMarker: provider.applyMarker,
    openDraftPr,
    ...(onAwaitingTicket ? { onAwaitingTicket } : {}),
    onLog,
  });

  const buildFeatureCtx = createFeatureContextBuilder({
    cwdByChange,
    projectRoot,
    bus,
    confirmationCaps,
    getPollContext: () => pollContext,
  });

  // PR recovery (RLF-173 / RLF-97). Disabled when the user passes
  // `--no-pr-recovery` or sets `prRecovery.enabled: false` in WORKFLOW.md. The
  // recovery counter / quarantine state now lives in the flow machine context
  // (persisted in the actor snapshot) — there is no separate tracker file.
  const prRecoveryEnabled =
    args.prRecoveryEnabled === undefined ? cfg.prRecovery.enabled : args.prRecoveryEnabled;

  // Task sync (plan-once + sticky tasks + steering refresh) + the spec sink
  // (RLF-239). Backend-specific IO comes pre-selected from the tracker bundle.
  const commentSync = createCommentSyncHooks({
    apiKey,
    cfg,
    projectRoot,
    onLog,
    ...(onFileLog ? { onFileLog } : {}),
    diag,
    cwdByChange,
    issueByChange,
    commentMutations,
    specSink,
    credentialsReady,
  });

  const coord = new AgentCoordinator(
    {
      beforePoll: () => {
        pollContext = new PollContext();
      },
      tracker,
      prepare: prep.prepare,
      prepareTaskForTrigger: prep.prepareTaskForTrigger,
      spawnWorker,
      checkPrStatus: prDiscovery.checkPrStatus,
      // Manual-merge fallback: wire the merge capability unless explicitly
      // disabled. The coordinator merges a verified-mergeable PR in
      // advancePrToDone instead of leaving it open (RLF-97 left it unmerged).
      ...(cfg.manualMergeWhenAutoMergeDisabled !== false ? { mergePr } : {}),
      hasPrForChange: (changeName) => prByChange.has(changeName),
      isChangeArchivedForIssue: (issue) =>
        isChangeArchivedForIssue(issue, cwdByChange, projectRoot),
      onLog,
      ...(onFileLog ? { onFileLog } : {}),
      onWorkersChanged,
      buildFeatureCtx,
      getIterationCount: (changeName) => readIterationCount(changeName, cwdByChange, projectRoot),
      getTasksFingerprint: (changeName) =>
        readTasksFingerprint(changeName, cwdByChange, projectRoot),
      ...(commentSync.enabled && commentSync.syncTasks ? { syncTasks: commentSync.syncTasks } : {}),
      ...(commentSync.enabled && commentSync.onSteeringAppended
        ? { onSteeringAppended: commentSync.onSteeringAppended }
        : {}),
    },
    buildCoordinatorOptions({
      concurrency,
      indicators,
      cfg,
      maxTickets: args.maxTickets,
      prRecoveryEnabled,
    }),
  );

  coordRef.current = coord;

  const filterDesc = describeIndicators(indicators, team, assignee, anyAssignee, requireAllLabels);

  const runBaselineGateOnce = createBaselineGateRunner({
    args,
    cfg,
    apiKey,
    team,
    projectRoot,
    cmdRunner,
    gitRunner,
    coord,
    onLog,
    resolveLabelIdForTeam: provider.resolveLabelIdForTeam,
  });

  return {
    coord,
    filterDesc,
    concurrency,
    pollInterval,
    getWorkerCwd: (changeName) => cwdByChange.get(changeName),
    syncTasksEnabled: commentSync.enabled,
    runBaselineGate: runBaselineGateOnce,
  };
}
