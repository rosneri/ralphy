import { join } from "node:path";
import type { Indicators } from "@ralphy/types";
import { resolveLinearFilter, linearFilterScope, applyAssigneeOverride } from "@ralphy/workflow";
import { createBus, subscribeAgentDiag } from "@ralphy/events";
import { PollContext } from "../shared/capabilities/poll-context";
import type { AgentParsedArgs } from "../cli";
import type { RalphyConfig } from "./config";
import { AgentCoordinator } from "./coordinator";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import { projectLayout } from "@ralphy/core/layout";
import { changeNameForIssue } from "./scaffold";
import type { ConfirmationCaps } from "../features/confirmation";
import type { FeatureCtx } from "../features/types";
import { processAwaitingForIssue } from "../features/confirmation/awaiting";

import {
  pickOpenPrUrlFromAttachments,
  resolveDependencyBaseBranchImpl,
  createOpenDraftPr,
} from "./wire/pr-helpers";
import { bunGitRunner, bunCmdRunner, type AgentRunners } from "./wire/runners";
import { mergeIndicators, unionMarkers, describeIndicators } from "./wire/indicators";
import { githubReactionSlug } from "./wire/task-bodies";
import {
  createLinearResolvers,
  fetchDoneCandidatesWith,
  type LinearResolvers,
} from "./wire/linear-resolvers";
import { createGithubTrackerProvider, githubIndicators } from "./wire/tracker/github";
import { createLinearTrackerProvider } from "./wire/tracker/linear-tracker-provider";
import type { TrackerProvider } from "./wire/tracker/types";
import { resolveTicketNumbers } from "../shared/capabilities/linear-client";
import { createPrepareHelpers } from "./wire/prepare";
import { createPrDiscovery } from "./wire/pr-discovery";
import {
  createGithubMentionScanner,
  createMentionScanner,
  isChangeArchivedForIssue,
} from "./wire/mention-scan";
import { createSpawnWorker, type WorkerPhase } from "./wire/spawn/worker";
import { createBaselineGateRunner } from "./wire/baseline";
import { createTrackerCommentSyncHooks } from "./wire/comment-sync";

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
  const diag = (area: string, message: string, color?: string): void => {
    bus.emit(
      color !== undefined
        ? { type: "agent.diag", area, message, color }
        : { type: "agent.diag", area, message },
    );
  };

  const concurrency = args.concurrency || cfg.concurrency;
  const pollInterval = args.pollInterval || cfg.pollIntervalSeconds;

  // The tracker selection (RLF-234). GitHub mode synthesizes label-based
  // indicators from `github.issues` and drives the loop off the `gh` CLI; Linear
  // mode is unchanged (config indicators + CLI overrides).
  const isGithubTracker = cfg.tracker.kind === "github";
  const indicators: Indicators = isGithubTracker
    ? githubIndicators(cfg.github?.issues)
    : mergeIndicators(cfg.linear.indicators as Record<string, unknown>, args.indicators);
  const team = args.linearTeam || cfg.linear.team;
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

  // GitHub mode lists open issues by label; without a dedicated todo label the
  // todo fetch returns every open issue, so the in-progress label must also be
  // excluded or in-flight work is re-picked. Linear's todo fetch is scoped by
  // its getTodo status filter, so its exclusion set stays as before.
  const excludeFromTodo = isGithubTracker
    ? unionMarkers(indicators.setDone, indicators.setError, indicators.setInProgress)
    : unionMarkers(indicators.setDone, indicators.setError);

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
  let useWorktree = args.worktree || cfg.useWorktree;
  // Concurrency > 1 requires isolated worktrees: parallel workers must not share
  // one working copy or they clobber each other's files. Force it on (and warn)
  // rather than silently corrupting the tree. The init wizard enforces the same
  // invariant up front; this backstops a hand-edited WORKFLOW.md.
  if (concurrency > 1 && !useWorktree) {
    diag(
      "config",
      `! concurrency is ${concurrency} but useWorktree is off — forcing worktrees on so parallel tasks get isolated working copies`,
      "yellow",
    );
    useWorktree = true;
  }

  const scriptRunner =
    input.runners?.runScript ??
    (async (cmd: string, cwd: string): Promise<number> => {
      const proc = Bun.spawn({
        cmd: ["sh", "-c", cmd],
        cwd,
        env: { ...process.env, WORKSPACE_ROOT: projectRoot },
        stdout: "ignore",
        stderr: "pipe",
        stdin: "ignore",
      });
      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        diag(
          "script",
          `! script exited code ${code}${stderr ? `: ${stderr.trim().split("\n")[0]}` : ""}`,
          "yellow",
        );
      }
      return code;
    });

  // Linear's GraphQL resolver bag (RLF-223). Only built in Linear mode; it is
  // both the source of the unified `provider` below and the input to the
  // `createLinearTrackerProvider` seam. GitHub mode drives the loop off the
  // gh-CLI provider instead, so it stays null.
  const resolvers: LinearResolvers | null = isGithubTracker
    ? null
    : createLinearResolvers({
        apiKey,
        team,
        assignee,
        anyAssignee,
        scope,
        diag,
        ...(ticketNumbers.length > 0 ? { ticketNumbers } : {}),
      });

  // The provider-agnostic indicator-dispatch + fetch surface used directly by
  // spawn / confirmation / baseline (and as the base for the GitHub tracker
  // seam below). Both branches conform to TrackerProvider. The Linear path
  // binds `fetchDoneCandidates` from the standalone helper (it needs the
  // indicator map); the GitHub provider implements it directly.
  // Built only in GitHub mode; retained as a typed handle so the mention
  // scanner can reach the GitHub-specific `listOpenIssues` / `repo` seams that
  // the tracker-neutral `TrackerProvider` does not expose.
  const githubProvider = isGithubTracker
    ? createGithubTrackerProvider({
        issues: cfg.github?.issues,
        cmdRunner,
        projectRoot,
        diag,
      })
    : null;
  const provider: TrackerProvider = githubProvider
    ? githubProvider
    : {
        ...resolvers!,
        fetchDoneCandidates: () =>
          fetchDoneCandidatesWith(
            apiKey,
            team,
            assignee,
            anyAssignee,
            scope,
            indicators,
            ticketNumbers.length > 0 ? ticketNumbers : undefined,
          ),
      };

  // RLF-208: when a ticket is targeted but it matches none of the configured
  // get-indicator buckets, the loop will pick up nothing — surface that so the
  // operator isn't left wondering why the run is idle.
  if (ticketNumbers.length > 0) {
    const hasGetIndicator = [indicators.getTodo, indicators.getInProgress].some(
      (ind) => ind && ind.filter.length > 0,
    );
    if (!hasGetIndicator) {
      diag(
        "ticket",
        `! --ticket set (${ticketNumbers.join(", ")}) but no getTodo/getInProgress indicator is configured — nothing will be picked up`,
        "yellow",
      );
    }
  }

  const prDiscovery = createPrDiscovery({
    apiKey,
    projectRoot,
    cmdRunner,
    onLog,
    diag,
    prByChange,
    getPollContext: () => pollContext,
    ignoreCiChecks: cfg.prRecovery.ignoreChecks,
  });

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

  // Mention re-engagement (RLF-240). Linear mode queries Linear for mentions of
  // the bot handle; GitHub mode scans open issue comments over REST (no
  // Search-API) via the dedicated scanner. Both are gated on
  // `linear.mentionTrigger` inside the scanner.
  const fetchMentions = githubProvider
    ? createGithubMentionScanner({
        cfg,
        cmdRunner,
        projectRoot,
        onLog,
        diag,
        listOpenIssues: githubProvider.listOpenIssues,
        repo: githubProvider.repo,
      })
    : createMentionScanner({
        apiKey,
        args,
        cfg,
        team,
        assignee,
        anyAssignee,
        scope,
        indicators,
        projectRoot,
        useWorktree,
        cmdRunner,
        onLog,
        diag,
        cwdByChange,
        ...(ticketNumbers.length > 0 ? { ticketNumbers } : {}),
        stalePingedAt,
        lastHandledReviewActivity,
        resolvePrUrlForIssue: prDiscovery.resolvePrUrlForIssue,
      });

  // RLF-223 (M1) + RLF-234: the tracker-neutral provider seam injected into
  // `CoordinatorDeps` below, so the coordinator never references a concrete
  // backend. Linear wraps its transport + resolvers + mention scanner via
  // `createLinearTrackerProvider`; GitHub builds the same `IssueTrackerProvider`
  // shape from the gh-CLI `provider`. Mentions, review and comment-fetch are
  // Linear-only today — GitHub returns empty sets (see design "Out of scope").
  const tracker: IssueTrackerProvider = isGithubTracker
    ? {
        fetchTodo: () => provider.fetchByGet(indicators.getTodo, excludeFromTodo),
        fetchInProgress: () =>
          provider.fetchByGet(indicators.getInProgress, unionMarkers(indicators.setError)),
        fetchReview: async () => [],
        fetchMentions,
        fetchDoneCandidates: () => provider.fetchDoneCandidates(),
        applyIndicator: provider.applyIndicator,
        removeIndicator: provider.removeIndicator,
        // Progress comments route through a `gh issue comment` via the
        // provider's comment marker.
        postComment: (issue, body) => provider.applyMarker(issue, { type: "comment", value: body }),
        fetchComments: async () => [],
      }
    : createLinearTrackerProvider({
        apiKey,
        team,
        assignee,
        anyAssignee,
        scope,
        indicators,
        resolvers: resolvers!,
        fetchMentions,
        ...(ticketNumbers.length > 0 ? { ticketNumbers } : {}),
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

  const confirmationCaps: ConfirmationCaps = {
    detect: (issue) =>
      processAwaitingForIssue(issue, {
        cfg,
        apiKey,
        projectRoot,
        useWorktree,
        indicators,
        cwdOf: (cn) => cwdByChange.get(cn),
        awaitingChangeSet,
        reapForAwaiting: (cn) => coordRef.current?.reapForAwaiting(cn),
        applyIndicator: provider.applyIndicator,
        applyMarker: provider.applyMarker,
        // prDraft: open the draft PR at the design-ready/park point. See
        // createOpenDraftPr — reuses the idempotent createPullRequest and skips
        // the meta-only guard so a design-only PR isn't blocked.
        openDraftPr,
        ...(onAwaitingTicket ? { onAwaitingTicket } : {}),
        onLog,
      }),
    run: async () => {},
  };

  function buildFeatureCtx(issue: TrackedIssue): FeatureCtx {
    return {
      issue,
      worktree: cwdByChange.get(changeNameForIssue(issue)) ?? projectRoot,
      state: { writeField: async () => {} },
      bus,
      caps: {
        gh: null,
        linear: null,
        git: null,
        fsChange: null,
        worker: null,
        confirmation: confirmationCaps,
      },
      poll: pollContext,
      now: () => new Date(),
    };
  }

  // PR recovery (RLF-173 / RLF-97). Disabled when the user passes
  // `--no-pr-recovery` or sets `prRecovery.enabled: false` in WORKFLOW.md. The
  // recovery counter / quarantine state now lives in the flow machine context
  // (persisted in the actor snapshot) — there is no separate tracker file.
  const prRecoveryEnabled =
    args.prRecoveryEnabled === undefined ? cfg.prRecovery.enabled : args.prRecoveryEnabled;

  // Task sync (plan-once + sticky tasks + steering refresh) to issue comments.
  // Linear uses its comment API; GitHub gets the marker-idempotent sticky-upsert
  // adapter. Spec attachments stay Linear-only (`attachmentsSupported: false`).
  const commentSync = createTrackerCommentSyncHooks({
    isGithubTracker,
    apiKey,
    cfg,
    projectRoot,
    onLog,
    diag,
    cwdByChange,
    issueByChange,
    cmdRunner,
    ...(githubProvider ? { githubRepo: githubProvider.repo } : {}),
  });

  const coord = new AgentCoordinator(
    {
      beforePoll: () => {
        pollContext = new PollContext();
      },
      fetchTodo: tracker.fetchTodo,
      fetchInProgress: tracker.fetchInProgress,
      fetchMentions: tracker.fetchMentions,
      fetchDoneCandidates: tracker.fetchDoneCandidates,
      // Forward-compat (RLF-223 M2): completes the provider surface in the deps
      // bag. Not polled today — see CoordinatorDeps.fetchReview.
      fetchReview: tracker.fetchReview,
      prepare: prep.prepare,
      prepareTaskForTrigger: prep.prepareTaskForTrigger,
      spawnWorker,
      applyIndicator: tracker.applyIndicator,
      removeIndicator: tracker.removeIndicator,
      postComment: tracker.postComment,
      fetchComments: tracker.fetchComments,
      checkPrStatus: prDiscovery.checkPrStatus,
      hasPrForChange: (changeName) => prByChange.has(changeName),
      isChangeArchivedForIssue: (issue) =>
        isChangeArchivedForIssue(issue, cwdByChange, projectRoot),
      onLog,
      ...(onFileLog ? { onFileLog } : {}),
      onWorkersChanged,
      buildFeatureCtx,
      getIterationCount: async (changeName) => {
        const root = cwdByChange.get(changeName) ?? projectRoot;
        const file = Bun.file(projectLayout(root).stateFile(changeName));
        if (!(await file.exists())) return 0;
        const json = (await file.json()) as { iteration?: number };
        return json.iteration ?? 0;
      },
      getTasksFingerprint: async (changeName) => {
        const root = cwdByChange.get(changeName) ?? projectRoot;
        const changeDir = projectLayout(root).changeDir(changeName);
        const parts: string[] = [];
        for (const name of ["tasks.md", "proposal.md", "design.md"]) {
          const file = Bun.file(join(changeDir, name));
          if (!(await file.exists())) continue;
          parts.push(`${name}:${file.lastModified}:${file.size}`);
        }
        return parts.length > 0 ? parts.join("|") : null;
      },
      ...(commentSync.enabled && commentSync.syncTasks ? { syncTasks: commentSync.syncTasks } : {}),
      ...(commentSync.enabled && commentSync.onSteeringAppended
        ? { onSteeringAppended: commentSync.onSteeringAppended }
        : {}),
    },
    {
      concurrency,
      ...(indicators.setInProgress !== undefined
        ? { setInProgress: indicators.setInProgress }
        : {}),
      ...(indicators.setDone !== undefined ? { setDone: indicators.setDone } : {}),
      ...(indicators.setError !== undefined ? { setError: indicators.setError } : {}),
      ...(indicators.getAutoMerge !== undefined ? { getAutoMerge: indicators.getAutoMerge } : {}),
      postComments: cfg.linear.postComments,
      commentEveryIterations: cfg.linear.updateEveryIterations,
      ...(args.maxTickets > 0 ? { maxTickets: args.maxTickets } : {}),
      createsPrs: args.createPr || cfg.createPrOnSuccess,
      prRecovery: {
        enabled: prRecoveryEnabled,
        fixCi: cfg.prRecovery.fixCi,
        fixConflicts: cfg.prRecovery.fixConflicts,
        maxRecoverySessions: cfg.prRecovery.maxRecoverySessions,
      },
    },
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
