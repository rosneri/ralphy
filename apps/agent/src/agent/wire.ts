import { join } from "node:path";
import type { Indicators } from "@ralphy/types";
import { resolveLinearFilter, applyAssigneeOverride } from "@ralphy/workflow";
import { createBus, subscribeAgentDiag } from "@ralphy/events";
import { PollContext } from "../shared/capabilities/poll-context";
import type { AgentParsedArgs } from "../cli";
import type { RalphyConfig } from "./config";
import { AgentCoordinator } from "./coordinator";
import { addIssueComment, fetchIssueComments, type LinearIssue } from "./linear";
import { projectLayout, GAVEUP_COUNT_FILE } from "@ralphy/core/layout";
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
import { createLinearResolvers, fetchDoneCandidatesWith } from "./wire/linear-resolvers";
import { resolveTicketNumbers } from "../shared/capabilities/linear-client";
import { createPrepareHelpers } from "./wire/prepare";
import { createPrDiscovery } from "./wire/pr-discovery";
import { createMentionScanner, isChangeArchivedForIssue } from "./wire/mention-scan";
import { createSpawnWorker, type WorkerPhase } from "./wire/spawn/worker";
import { createBaselineGateRunner } from "./wire/baseline";
import { createCommentSyncHooks } from "./wire/comment-sync";
import { PrTracker } from "../features/pr-tracker";

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
  /** Durable sum of `gaveUpCount` across every change this session knows
   *  about (read from each change's `.ralph-state.json`). Survives agent
   *  restarts: in-progress changes are re-prepared on boot, so their
   *  persisted give-up tallies are counted again rather than reset. */
  getGaveUpTotal: () => Promise<number>;
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

  const indicators: Indicators = mergeIndicators(
    cfg.linear.indicators as Record<string, unknown>,
    args.indicators,
  );
  const team = args.linearTeam || cfg.linear.team;
  // The global `linear.filter` (marker list of label + assignee clauses) scopes
  // every Linear query and, transitively, the GitHub PR searches rooted at those
  // issues. `--linear-assignee` overrides just the assignee clause for this run.
  const { assignee, anyAssignee, requireAllLabels } = resolveLinearFilter(
    applyAssigneeOverride(cfg.linear.filter, args.linearAssignee),
  );

  // RLF-208: resolve --ticket tokens to a deduped set of Linear ticket numbers,
  // validated against the configured team. Throws a clean CLI error on a bare
  // number without a team or an identifier whose team disagrees.
  const ticketNumbers = resolveTicketNumbers(args.ticketTokens, team);

  const excludeFromTodo = unionMarkers(indicators.setDone, indicators.setError);

  const gitRunner = input.runners?.git ?? bunGitRunner;
  const cmdRunner = input.runners?.cmd ?? bunCmdRunner;

  // Per-changeName book-keeping maps shared across helpers.
  const cwdByChange = new Map<string, string>();
  const statesDirByChange = new Map<string, string>();
  const branchByChange = new Map<string, string>();
  const issueByChange = new Map<string, LinearIssue>();
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

  const resolvers = createLinearResolvers({
    apiKey,
    team,
    assignee,
    anyAssignee,
    requireAllLabels,
    diag,
    ...(ticketNumbers.length > 0 ? { ticketNumbers } : {}),
  });

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
  });

  const fetchMentions = createMentionScanner({
    apiKey,
    args,
    cfg,
    team,
    assignee,
    anyAssignee,
    requireAllLabels,
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
    applyIndicator: resolvers.applyIndicator,
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
        applyIndicator: resolvers.applyIndicator,
        applyMarker: resolvers.applyMarker,
        // prDraft: open the draft PR at the design-ready/park point. See
        // createOpenDraftPr — reuses the idempotent createPullRequest and skips
        // the meta-only guard so a design-only PR isn't blocked.
        openDraftPr,
        ...(onAwaitingTicket ? { onAwaitingTicket } : {}),
        onLog,
      }),
    run: async () => {},
  };

  function buildFeatureCtx(issue: LinearIssue): FeatureCtx {
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

  // pr-tracker (RLF-173): persistent recovery counter for In-Review PRs.
  // Disabled when the user passes `--no-pr-tracker` or sets
  // `prTracker.enabled: false` in WORKFLOW.md. Lazily-loaded state file
  // means the first `recordFailure` call materializes `.ralph/pr-tracker-state.json`.
  const prTrackerEnabled =
    args.prTrackerEnabled === undefined ? cfg.prTracker.enabled : args.prTrackerEnabled;
  const prTracker = prTrackerEnabled
    ? new PrTracker({
        projectRoot,
        maxRecoveryAttempts: cfg.prTracker.maxRecoveryAttempts,
      })
    : null;

  const commentSync = createCommentSyncHooks({
    apiKey,
    cfg,
    projectRoot,
    onLog,
    diag,
    cwdByChange,
    issueByChange,
  });

  const coord = new AgentCoordinator(
    {
      beforePoll: () => {
        pollContext = new PollContext();
      },
      fetchTodo: () => resolvers.fetchByGet(indicators.getTodo, excludeFromTodo),
      fetchInProgress: () =>
        resolvers.fetchByGet(indicators.getInProgress, unionMarkers(indicators.setError)),
      fetchMentions,
      fetchDoneCandidates: () =>
        fetchDoneCandidatesWith(
          apiKey,
          team,
          assignee,
          anyAssignee,
          requireAllLabels,
          indicators,
          ticketNumbers.length > 0 ? ticketNumbers : undefined,
        ),
      prepare: prep.prepare,
      prepareTaskForTrigger: prep.prepareTaskForTrigger,
      spawnWorker,
      applyIndicator: resolvers.applyIndicator,
      removeIndicator: resolvers.removeIndicator,
      postComment: (issue, body) => addIssueComment(apiKey, issue.id, body),
      fetchComments: async (issueId) => {
        const c = await fetchIssueComments(apiKey, issueId);
        return c.map((x) => ({ body: x.body }));
      },
      checkPrStatus: prDiscovery.checkPrStatus,
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
      ...(prTracker ? { prTracker } : {}),
    },
  );

  coordRef.current = coord;

  const filterDesc = describeIndicators(indicators, team, assignee, anyAssignee);

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
    resolveLabelIdForTeam: resolvers.resolveLabelIdForTeam,
  });

  return {
    coord,
    filterDesc,
    concurrency,
    pollInterval,
    getWorkerCwd: (changeName) => cwdByChange.get(changeName),
    syncTasksEnabled: commentSync.enabled,
    runBaselineGate: runBaselineGateOnce,
    getGaveUpTotal: async () => {
      let total = 0;
      for (const [changeName, root] of cwdByChange) {
        const file = Bun.file(
          join(projectLayout(root).taskStateDir(changeName), GAVEUP_COUNT_FILE),
        );
        if (!(await file.exists())) continue;
        try {
          total += Number.parseInt(await file.text(), 10) || 0;
        } catch {
          /* skip unreadable sidecar */
        }
      }
      return total;
    },
  };
}
