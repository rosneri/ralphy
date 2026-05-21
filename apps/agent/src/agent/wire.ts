import { dirname, join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { projectLayout } from "@ralphy/core/layout";
import {
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
  normalizeNewlyAppendedSectionWithReport,
} from "@ralphy/core/tasks-md";
import { fsChange } from "../shared/capabilities/fs-change";
import { git } from "../shared/capabilities/git";
import { runCapability } from "../shared/capabilities/run-capability";
import { loadWorkflow, renderWorkflowPrompt } from "@ralphy/workflow";
import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { ParsedArgs } from "../cli";
import type { RalphyConfig } from "./config";
import {
  fetchOpenIssues,
  fetchMentionScanIssues,
  addIssueComment,
  addReactionToComment,
  fetchIssueComments,
  fetchIssueAttachments,
  upsertRalphyAttachment,
  fetchWorkflowStates,
  updateIssueState,
  fetchIssueLabels,
  fetchTeamIdByKey,
  uploadFileToLinear,
  createAttachmentForUrl,
  deleteAttachment,
  findIssueAttachmentByTitle,
  createIssueLabel,
  addLabelToIssue,
  removeLabelFromIssue,
  createIssue,
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  updateIssueDescription,
  findOpenIssueByLabel,
  issueMatchesGetIndicator,
  fetchProjectIdByName,
  setIssueProject,
  baseBranchFromLabels,
  formatLinearError,
  isRateLimitedError,
  type LinearIssue,
  type LinearFilterSpec,
} from "./linear";
import {
  AgentCoordinator,
  type QueueTrigger,
  type PrepareResult,
  type MentionTrigger,
  type PrStatus,
} from "./coordinator";
import { changeNameForIssue, scaffoldChangeForIssue } from "./scaffold";
import { type GitRunner } from "./worktree";
import { type CmdRunner } from "./pr";
import { PollContext } from "../shared/capabilities/poll-context";
import { discoverPrUrlFromGitHub, createPrUrlCache } from "./pr-url";
import { getPrChecksStatus } from "./ci";
import { runPostTask, type PostTaskPhase } from "./post-task";
import { runBaselineGate } from "./baseline/gate";
import { resolveBaselineCommands } from "@ralphy/workflow";
import {
  postOrUpdateTasksComment,
  postPlanCommentOnce,
  postSteeringAndRefreshTasks,
  type CommentMutations,
} from "./linear-sync/comment-sync";
import { syncSpecAttachments, type SpecAttachmentMutations } from "./linear-sync/spec-attachments";
import type { ConfirmationCaps } from "../features/confirmation";
import type { FeatureCtx } from "../features/types";
import { createNoopBus } from "@ralphy/events";

// Extracted helpers
import { pickOpenPrUrlFromAttachments, resolveDependencyBaseBranchImpl } from "./wire-pr-helpers";
import { bunGitRunner, bunCmdRunner, traceCmdRunner, type AgentRunners } from "./wire-runners";
import { mergeIndicators, unionMarkers, describeIndicators } from "./wire-indicators";
import {
  buildReviewTaskBody,
  buildMentionTaskBody,
  isRalphComment,
  containsHandle,
  findLastRalphPickupISO,
  githubReactionSlug,
} from "./wire-task-bodies";
import { defaultSpawn } from "./wire-spawn";
import { scanCodeReview } from "../features/review-followup/scan";
import { addGithubReactionToComment, fetchPrIssueComments } from "../features/mention/github";
import { processAwaitingForIssue } from "../features/confirmation/awaiting";

// Re-export public surface for tests
export { pickOpenPrUrlFromAttachments, resolveDependencyBaseBranchImpl, githubReactionSlug };
export type { AgentRunners };

/** Phases the dashboard surfaces per worker. Superset of PostTaskPhase
 *  plus the worker-subprocess "working" phase. */
type WorkerPhase = PostTaskPhase | "working" | "scaffolding";

interface BuildAgentCoordinatorInput {
  args: ParsedArgs;
  cfg: RalphyConfig;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  apiKey: string;
  /** Receive log lines for the UI. */
  onLog: (text: string, color?: string) => void;
  /** Receive log lines that should be written to the agent-mode log file but
   *  not displayed in the UI log panel (e.g. the per-poll summary). */
  onFileLog?: (text: string) => void;
  /** Called whenever the active-worker set changes (drives re-render). */
  onWorkersChanged: () => void;
  /** Called when a new worker subprocess starts. */
  onWorkerStarted: (
    changeName: string,
    statesDir: string,
    logFile: string,
    changeDir: string,
  ) => void;
  /** Called after the post-task block resolves; UI drops the worker row. */
  onWorkerExited: (changeName: string) => void;
  /** Phase transition for a worker — dashboard renders alongside iter+elapsed. */
  onWorkerPhase?: (changeName: string, phase: WorkerPhase, detail?: string) => void;
  /** A line of stdout/stderr captured from the worker subprocess. */
  onWorkerOutput?: (changeName: string, line: string) => void;
  /** Live shell-command tracer. */
  onWorkerCmd?: (
    changeName: string,
    cmd: string[],
    state: "start" | "end",
    durationMs?: number,
    ok?: boolean,
  ) => void;
  /** Called when a PR URL is registered for a worker. */
  onWorkerPr?: (changeName: string, prUrl: string) => void;
  /** Called once per poll per ticket parked in `awaiting-confirmation`. */
  onAwaitingTicket?: (info: {
    changeName: string;
    issueIdentifier: string;
    issueUrl: string;
    issueTitle: string;
    since: string | null;
    round: number;
  }) => void;
  /** Optional side-effect overrides (test injection). */
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

/**
 * Build a fully wired `AgentCoordinator`. Owns the per-change book-keeping
 * maps, the workflow-state / label resolver caches, the prepare and
 * spawnWorker callbacks, and the post-task hand-off.
 */
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

  const concurrency = args.concurrency || cfg.concurrency;
  const pollInterval = args.pollInterval || cfg.pollIntervalSeconds;

  const indicators: Indicators = mergeIndicators(
    cfg.linear.indicators as Record<string, unknown>,
    args.indicators,
  );
  const team = args.linearTeam || cfg.linear.team;
  const assignee = args.linearAssignee || cfg.linear.assignee;

  const excludeFromTodo = unionMarkers(
    indicators.setDone,
    indicators.setError,
    indicators.setConflicted,
  );
  const excludeFromReview = unionMarkers(
    indicators.setInProgress,
    indicators.setError,
    indicators.setConflicted,
  );

  const gitRunner: GitRunner = input.runners?.git ?? bunGitRunner;
  const cmdRunner: CmdRunner = input.runners?.cmd ?? bunCmdRunner;

  const stateCache = new Map<string, Map<string, string>>();
  const labelCache = new Map<string, Map<string, string>>();
  const teamIdCache = new Map<string, string>();
  const teamKeyOf = (issue: LinearIssue): string => issue.identifier.split("-")[0]!;

  async function resolveStateId(issue: LinearIssue, name: string): Promise<string | null> {
    const t = teamKeyOf(issue);
    let map = stateCache.get(t);
    if (!map) {
      const states = await fetchWorkflowStates(apiKey, t);
      map = new Map(states.map((s) => [s.name.toLowerCase(), s.id]));
      stateCache.set(t, map);
    }
    return map.get(name.toLowerCase()) ?? null;
  }

  async function resolveLabelId(issue: LinearIssue, name: string): Promise<string | null> {
    const t = teamKeyOf(issue);
    let map = labelCache.get(t);
    if (!map) {
      const labels = await fetchIssueLabels(apiKey, t);
      map = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
      labelCache.set(t, map);
    }
    const existing = map.get(name.toLowerCase());
    if (existing) return existing;
    try {
      let teamId = teamIdCache.get(t);
      if (!teamId) {
        const fetched = await fetchTeamIdByKey(apiKey, t);
        if (!fetched) return null;
        teamId = fetched;
        teamIdCache.set(t, teamId);
      }
      const newId = await createIssueLabel(apiKey, teamId, name);
      if (!newId) return null;
      map.set(name.toLowerCase(), newId);
      onLog(`  created Linear label '${name}' for team ${t}`, "gray");
      return newId;
    } catch (err) {
      const e = err as Error & { messages?: string[] };
      const detail = e.messages?.length ? ` — ${e.messages.join("; ")}` : "";
      onLog(`! Linear label '${name}' creation threw: ${e.message}${detail}`, "yellow");
      labelCache.delete(t);
      return null;
    }
  }

  async function applyMarker(issue: LinearIssue, m: Marker): Promise<void> {
    if (m.type === "status") {
      const id = await resolveStateId(issue, m.value);
      if (!id) {
        const err = new Error("Linear status not found") as Error & {
          status?: string;
          issue?: string;
        };
        err.status = m.value;
        err.issue = issue.identifier;
        throw err;
      }
      await updateIssueState(apiKey, issue.id, id);
      onLog(`  → ${issue.identifier} status='${m.value}'`, "gray");
    } else if (m.type === "attachment") {
      await upsertRalphyAttachment(apiKey, issue.id, issue.url, m.value);
      onLog(`  → ${issue.identifier} attachment='${m.value}'`, "gray");
    } else if (m.type === "project") {
      const projectId = await fetchProjectIdByName(apiKey, m.value);
      if (!projectId) {
        const err = new Error("Linear project not found") as Error & {
          project?: string;
          issue?: string;
        };
        err.project = m.value;
        err.issue = issue.identifier;
        throw err;
      }
      await setIssueProject(apiKey, issue.id, projectId);
      onLog(`  → ${issue.identifier} project='${m.value}'`, "gray");
    } else {
      const id = await resolveLabelId(issue, m.value);
      if (!id) {
        const err = new Error("Linear label could not be resolved") as Error & {
          label?: string;
          issue?: string;
        };
        err.label = m.value;
        err.issue = issue.identifier;
        throw err;
      }
      await addLabelToIssue(apiKey, issue.id, id);
      onLog(`  → ${issue.identifier} +label='${m.value}'`, "gray");
    }
  }

  async function applyIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) await applyMarker(issue, m);
  }

  async function removeIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) {
      if (m.type !== "label") continue;
      const id = await resolveLabelId(issue, m.value);
      if (!id) {
        onLog(`! Linear label '${m.value}' not found for ${issue.identifier}`, "yellow");
        continue;
      }
      await removeLabelFromIssue(apiKey, issue.id, id);
      onLog(`  → ${issue.identifier} -label='${m.value}'`, "gray");
    }
  }

  async function fetchByGet(
    inc: SetIndicator | { filter: Marker[] } | undefined,
    excl: Marker[],
  ): Promise<LinearIssue[]> {
    if (!inc) return [];
    const include = !Array.isArray(inc) && "filter" in inc ? inc.filter : [];
    if (include.length === 0) return [];
    const spec: LinearFilterSpec = { team, assignee, include, exclude: excl };
    return fetchOpenIssues(apiKey, spec);
  }

  // Per-changeName book-keeping.
  const cwdByChange = new Map<string, string>();
  const statesDirByChange = new Map<string, string>();
  const branchByChange = new Map<string, string>();
  const issueByChange = new Map<string, LinearIssue>();
  const prByChange = new Map<string, string>();
  const prUnavailable = new Map<string, number>();
  const PR_UNAVAILABLE_TTL_MS = 10 * 60 * 1000;
  const prUrlByIssue = createPrUrlCache(5 * 60 * 1000);
  const stalePingedAt = new Map<string, number>();
  const lastHandledReviewActivity = new Map<string, string>();

  let pollContext = new PollContext();

  const useWorktree = args.worktree || cfg.useWorktree;

  const awaitingChangeSet = new Set<string>();
  const coordRef: { current: AgentCoordinator | null } = { current: null };

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
        onLog(
          `! script exited code ${code}${stderr ? `: ${stderr.trim().split("\n")[0]}` : ""}`,
          "yellow",
        );
      }
      return code;
    });

  async function runScript(label: string, cmd: string, cwd: string): Promise<void> {
    onLog(`  ${label}: ${cmd}`, "gray");
    const code = await scriptRunner(cmd, cwd);
    if (code !== 0) {
      onLog(`! ${label} exited code ${code}`, "yellow");
    }
  }

  async function setupWorktree(issue: LinearIssue): Promise<{
    workerCwd: string;
    scaffoldTasksDir: string;
    scaffoldStatesDir: string;
    branch: string | null;
  }> {
    let workerCwd = projectRoot;
    let scaffoldTasksDir = tasksDir;
    let scaffoldStatesDir = statesDir;
    let branch: string | null = null;
    if (!useWorktree) return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch };
    const probeName = issue.identifier.toLowerCase();
    const baseBranch = baseBranchFromLabels(issue.labels) ?? cfg.prBaseBranch;
    let wt: { cwd: string; branch: string };
    try {
      wt = await runCapability(git.createWorktree, {
        projectRoot,
        changeName: probeName,
        baseBranch,
        runner: gitRunner,
      });
    } catch (err) {
      onLog(
        `! worktree create failed for ${issue.identifier}: ${(err as Error).message} — skipping (useWorktree is required)`,
        "red",
      );
      throw err;
    }
    workerCwd = wt.cwd;
    branch = wt.branch;
    const wtLayout = projectLayout(wt.cwd);
    scaffoldTasksDir = wtLayout.tasksDir;
    scaffoldStatesDir = wtLayout.statesDir;
    onLog(`  ${issue.identifier} worktree: ${wt.cwd} (${wt.branch})`, "gray");
    try {
      await runCapability(git.seedWorktreeMcpConfig, {
        projectRoot,
        worktreeCwd: wt.cwd,
      });
    } catch (err) {
      onLog(
        `! seeding .mcp.json failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
    return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch };
  }

  async function prepare(issue: LinearIssue): Promise<PrepareResult> {
    const { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch } = await setupWorktree(issue);

    let changeName: string;
    const wtLayoutPre = projectLayout(workerCwd);
    const derivedName = changeNameForIssue(issue);
    const tasksMdPath = join(wtLayoutPre.changeDir(derivedName), "tasks.md");
    const tasksMdExists = await Bun.file(tasksMdPath).exists();
    const isFresh = !tasksMdExists;
    if (isFresh) {
      let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
      try {
        comments = await fetchIssueComments(apiKey, issue.id);
      } catch (err) {
        onLog(
          `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
      let workflowPrompt = "";
      try {
        const workflow = await loadWorkflow(projectRoot);
        workflowPrompt = renderWorkflowPrompt(workflow, {
          issue: {
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? "",
            url: issue.url,
            labels: issue.labels,
          },
          attempt: 1,
          last_error: "",
        }).trim();
      } catch (err) {
        onLog(`! workflow render failed: ${(err as Error).message}`, "yellow");
      }
      const appendPrompt = [args.prompt || cfg.appendPrompt || "", workflowPrompt]
        .filter(Boolean)
        .join("\n\n");
      changeName = await scaffoldChangeForIssue(
        scaffoldTasksDir,
        scaffoldStatesDir,
        issue,
        comments,
        appendPrompt,
      );
    } else {
      changeName = derivedName;
      await mkdir(wtLayoutPre.changeDir(changeName), { recursive: true });
      await mkdir(wtLayoutPre.taskStateDir(changeName), { recursive: true });
    }

    cwdByChange.set(changeName, workerCwd);
    statesDirByChange.set(changeName, scaffoldStatesDir);
    issueByChange.set(changeName, issue);
    if (branch) branchByChange.set(changeName, branch);

    if (cfg.setupScript) {
      await runScript("setup", cfg.setupScript, workerCwd);
    }

    return {
      changeName,
      ...(prByChange.has(changeName) ? { prUrl: prByChange.get(changeName)! } : {}),
    };
  }

  async function prepareTaskForTrigger(
    issue: LinearIssue,
    changeName: string,
    trigger: QueueTrigger,
    mention?: MentionTrigger,
  ): Promise<void> {
    if (trigger !== "review" && trigger !== "conflict-fix") return;
    const workerCwd = cwdByChange.get(changeName);
    if (!workerCwd) return;
    const wtLayout = projectLayout(workerCwd);
    const tasksFile = join(wtLayout.changeDir(changeName), AGENT_TASKS_FILENAME);
    if (trigger === "review") {
      let body: string;
      let heading: string;
      if (mention) {
        heading =
          mention.source === "github"
            ? "Address GitHub @ralphy mention"
            : "Address Linear @ralphy mention";
        body = buildMentionTaskBody(mention, issue.url);
      } else {
        heading = "Address reviewer comments";
        let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
        try {
          comments = await fetchIssueComments(apiKey, issue.id);
        } catch (err) {
          onLog(
            `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
        const reviewerComments = comments.filter((c) => !isRalphComment(c.body));
        body = buildReviewTaskBody(reviewerComments, issue.url);
      }
      try {
        await runCapability(fsChange.prependTask, {
          tasksPath: tasksFile,
          heading,
          failureOutput: body,
        });
      } catch (err) {
        onLog(`! could not prepend review task: ${(err as Error).message}`, "red");
      }
      await reactivateState(wtLayout.stateFile(changeName), changeName);
      return;
    }
    // conflict-fix
    const prUrl = prByChange.get(changeName);
    const body = [
      `The PR for this change has merge conflicts with \`${cfg.prBaseBranch}\`.`,
      "",
      "Steps:",
      `1. \`git fetch origin ${cfg.prBaseBranch}\` then rebase or merge \`${cfg.prBaseBranch}\` into the current branch.`,
      "2. Resolve conflicts in the files git lists.",
      "3. Stage and commit the resolution.",
      prUrl ? `\nPR: ${prUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await runCapability(fsChange.prependTask, {
        tasksPath: tasksFile,
        heading: "Resolve PR merge conflicts",
        failureOutput: body,
      });
    } catch (err) {
      onLog(`! could not prepend conflict-fix task: ${(err as Error).message}`, "red");
    }
    await reactivateState(wtLayout.stateFile(changeName), changeName);
  }

  async function reactivateState(stateFilePath: string, changeName: string): Promise<void> {
    const file = Bun.file(stateFilePath);
    if (!(await file.exists())) return;
    try {
      const stateObj = JSON.parse(await file.text()) as {
        status?: string;
        lastModified?: string;
      };
      if (stateObj.status !== "active") {
        stateObj.status = "active";
        stateObj.lastModified = new Date().toISOString();
        await Bun.write(stateFilePath, JSON.stringify(stateObj, null, 2) + "\n");
      }
    } catch (err) {
      onLog(`! could not reactivate state for ${changeName}: ${(err as Error).message}`, "yellow");
    }
  }

  function buildTaskCmdFor(changeName: string): string[] {
    const c: string[] = [
      process.execPath,
      process.argv[1] ?? "",
      "loop",
      "task",
      "--name",
      changeName,
      "--" + (args.engineSet ? args.engine : cfg.engine),
      args.engineSet ? args.model : cfg.model,
    ];
    const maxIter = args.maxIterations || cfg.maxIterationsPerTask;
    if (maxIter > 0) c.push("--max-iterations", String(maxIter));
    const maxCost = args.maxCostUsd || cfg.maxCostUsdPerTask;
    if (maxCost > 0) c.push("--max-cost", String(maxCost));
    const maxRuntime = args.maxRuntimeMinutes || cfg.maxRuntimeMinutesPerTask;
    if (maxRuntime > 0) c.push("--max-runtime", String(maxRuntime));
    const maxFailures =
      args.maxConsecutiveFailures !== 5
        ? args.maxConsecutiveFailures
        : cfg.maxConsecutiveFailuresPerTask;
    if (maxFailures !== 5) c.push("--max-failures", String(maxFailures));
    const delay = args.delay || cfg.iterationDelaySeconds;
    if (delay > 0) c.push("--delay", String(delay));
    if (args.log || cfg.logRawStream) c.push("--log");
    if (args.verbose || cfg.taskVerbose) c.push("--verbose");
    if (args.manualTest || cfg.enableManualTest) c.push("--manual-test");
    c.push("--from-agent");
    return c;
  }

  function spawnWorker(changeName: string): { exited: Promise<number>; kill: () => void } {
    const cwd = cwdByChange.get(changeName) ?? projectRoot;
    const injected = input.runners?.spawnWorker;

    const missionTasksPath = join(projectLayout(cwd).changeDir(changeName), MISSION_TASKS_FILENAME);
    const prevTasksPromise: Promise<string> = (async () => {
      const f = Bun.file(missionTasksPath);
      return (await f.exists()) ? await f.text() : "";
    })();

    let logFilePath: string;
    let handle: { exited: Promise<number>; kill: () => void };
    if (injected) {
      logFilePath = join(logsDir, `${changeName}.log`);
      handle = injected(buildTaskCmdFor(changeName), cwd);
    } else {
      const r = defaultSpawn(
        changeName,
        buildTaskCmdFor(changeName),
        cwd,
        logsDir,
        onWorkerOutput,
        `spawn at ${new Date().toISOString()}`,
      );
      logFilePath = r.logFilePath;
      handle = { exited: r.exited, kill: r.kill };
    }
    const respawn = (): Promise<number> => {
      onWorkerPhase?.(changeName, "working", "respawn");
      if (injected) return injected(buildTaskCmdFor(changeName), cwd).exited;
      return defaultSpawn(
        changeName,
        buildTaskCmdFor(changeName),
        cwd,
        logsDir,
        onWorkerOutput,
        `respawn at ${new Date().toISOString()}`,
      ).exited;
    };
    onWorkerStarted(
      changeName,
      statesDirByChange.get(changeName) ?? statesDir,
      logFilePath,
      projectLayout(cwd).changeDir(changeName),
    );
    onWorkerPhase?.(changeName, "working");

    const tracedCmd = onWorkerCmd
      ? traceCmdRunner(
          cmdRunner,
          (cmd) => onWorkerCmd(changeName, cmd, "start"),
          (cmd, ms, ok) => onWorkerCmd(changeName, cmd, "end", ms, ok),
        )
      : cmdRunner;

    const wantPrBase = args.createPr || cfg.createPrOnSuccess;
    const wantFixCi = args.fixCi || cfg.fixCiOnFailure;
    const issueForChange = issueByChange.get(changeName);
    const wantAutoMerge = issueForChange
      ? issueMatchesGetIndicator(issueForChange, indicators.getAutoMerge)
      : false;
    const wrapped = handle.exited.then(async (code) => {
      const workerLayout = projectLayout(cwd);
      try {
        const prevTasks = await prevTasksPromise;
        const nextFile = Bun.file(missionTasksPath);
        if (await nextFile.exists()) {
          const nextTasks = await nextFile.text();
          const report = normalizeNewlyAppendedSectionWithReport(prevTasks, nextTasks);
          if (report.text !== nextTasks) {
            await Bun.write(missionTasksPath, report.text);
            const sections = report.headings.map((h) => `## ${h}`).join(", ");
            onLog(
              `! normalized ${report.count} pre-checked item(s) in newly added section(s) ${sections}`,
              "yellow",
            );
          }
        }
      } catch (err) {
        onLog(`! tasks.md normalization failed: ${(err as Error).message}`, "yellow");
      }
      const wantPr =
        wantPrBase &&
        !awaitingChangeSet.has(changeName) &&
        !(coordRef.current?.isAwaitingConfirmation(changeName) ?? false);
      const effectiveCode = await runPostTask(
        {
          changeName,
          cwd,
          projectRoot,
          changeDir: workerLayout.changeDir(changeName),
          stateFilePath: workerLayout.stateFile(changeName),
          branch: branchByChange.get(changeName) ?? null,
          issue: issueByChange.get(changeName) ?? null,
          exitCode: code,
          useWorktree,
          wantPr,
          wantFixCi,
          wantAutoMerge,
          cfg: {
            teardownScript: cfg.teardownScript ?? null,
            prBaseBranch: cfg.prBaseBranch,
            autoMergeStrategy: cfg.autoMergeStrategy,
            maxCiFixAttempts: cfg.maxCiFixAttempts,
            ciPollIntervalSeconds: cfg.ciPollIntervalSeconds,
            cleanupWorktreeOnSuccess: cfg.cleanupWorktreeOnSuccess,
            ignoreCiChecks: cfg.ignoreCiChecks,
            stackPrsOnDependencies: args.stackPrs || cfg.stackPrsOnDependencies,
            neverTouch: cfg.boundaries.never_touch,
            metaOnlyFiles: cfg.boundaries.meta_only_files,
            manualMergeWhenAutoMergeDisabled: cfg.manualMergeWhenAutoMergeDisabled,
          },
          respawnWorker: respawn,
        },
        {
          cmd: tracedCmd,
          git: gitRunner,
          log: onLog,
          runScript,
          registerPr: (cn, url) => {
            prByChange.set(cn, url);
            prUnavailable.delete(cn);
            const issue = issueByChange.get(cn);
            if (issue) prUrlByIssue.invalidate(issue.id);
            input.onWorkerPr?.(cn, url);
          },
          ...(onWorkerPhase && {
            onPhase: (phase: PostTaskPhase, detail?: string) =>
              onWorkerPhase(changeName, phase, detail),
          }),
          checkPrConflict: async (prUrl: string) => {
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const res = await tracedCmd.run(
                  ["gh", "pr", "view", prUrl, "--json", "mergeable", "--jq", ".mergeable"],
                  cwd,
                );
                const mergeable = res.stdout.trim();
                if (mergeable !== "UNKNOWN") return mergeable === "CONFLICTING";
              } catch {
                return false;
              }
              await new Promise<void>((r) => setTimeout(r, 2000));
            }
            return false;
          },
          resolveDependencyBaseBranch: (issue) =>
            resolveDependencyBaseBranchImpl(issue, tracedCmd, cwd, { apiKey, onLog }),
        },
      );
      cwdByChange.delete(changeName);
      statesDirByChange.delete(changeName);
      branchByChange.delete(changeName);
      issueByChange.delete(changeName);
      onWorkerExited(changeName);
      return effectiveCode;
    });

    return { exited: wrapped, kill: () => handle.kill() };
  }

  async function checkPrStatus(
    issue: LinearIssue,
  ): Promise<{ url: string; status: PrStatus } | null> {
    const changeName = changeNameForIssue(issue);
    if (isPrUnavailable(changeName)) return null;

    let prUrl: string | undefined = prByChange.get(changeName);
    if (!prUrl) {
      const found = await discoverPrUrl(issue, changeName);
      if (!found) return null;
      prUrl = found;
      prByChange.set(changeName, prUrl);
    }

    let mergeable: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let state: string | undefined;
      let m: string | undefined;
      try {
        const parsed = (await pollContext.fetchPrOnce(
          prUrl,
          ["state", "mergeable"],
          cmdRunner,
          projectRoot,
        )) as { state?: string; mergeable?: string };
        state = parsed.state;
        m = parsed.mergeable;
      } catch (err) {
        onLog(`! gh pr view ${prUrl} failed (PR scan): ${(err as Error).message}`, "yellow");
        return { url: prUrl, status: "unknown" };
      }
      if (state && state !== "OPEN") {
        markPrUnavailable(changeName);
        prUrlByIssue.invalidate(issue.id);
        return null;
      }
      if (m && m !== "UNKNOWN") {
        mergeable = m;
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 2000));
    }
    if (mergeable === null) {
      onLog(
        `  ${issue.identifier}: mergeability still UNKNOWN after retries (${prUrl}) — will recheck next poll`,
        "gray",
      );
      return { url: prUrl, status: "unknown" };
    }
    if (mergeable === "CONFLICTING") return { url: prUrl, status: "conflicted" };

    try {
      const ci = await getPrChecksStatus(prUrl, cmdRunner, projectRoot);
      if (ci.bucket === "fail") return { url: prUrl, status: "ci_failed" };
    } catch (err) {
      onLog(`! gh pr checks ${prUrl} failed (PR scan): ${(err as Error).message}`, "yellow");
    }
    return { url: prUrl, status: "mergeable" };
  }

  function isPrUnavailable(changeName: string): boolean {
    const expiry = prUnavailable.get(changeName);
    if (expiry === undefined) return false;
    if (Date.now() >= expiry) {
      prUnavailable.delete(changeName);
      return false;
    }
    return true;
  }
  function markPrUnavailable(changeName: string): void {
    prUnavailable.set(changeName, Date.now() + PR_UNAVAILABLE_TTL_MS);
  }

  async function discoverPrUrl(issue: LinearIssue, changeName: string): Promise<string | null> {
    const fromGitHub = await discoverPrUrlFromGitHub(
      issue.identifier,
      cmdRunner,
      projectRoot,
      onLog,
    );
    if (fromGitHub) return fromGitHub;

    const fromLinear = await discoverPrUrlFromLinear(issue);
    if (fromLinear.url) {
      onLog(
        `  ${issue.identifier}: PR discovered via Linear attachment (${fromLinear.url})`,
        "gray",
      );
      return fromLinear.url;
    }

    if (fromLinear.sawNonOpenPr) {
      markPrUnavailable(changeName);
      return null;
    }

    onLog(
      `  ${issue.identifier}: no PR found via GitHub search or Linear attachments; conflict scan skipped for ${PR_UNAVAILABLE_TTL_MS / 60000}m`,
      "gray",
    );
    markPrUnavailable(changeName);
    return null;
  }

  async function discoverPrUrlFromLinear(
    issue: LinearIssue,
  ): Promise<{ url: string | null; sawNonOpenPr: boolean }> {
    let attachments;
    try {
      attachments = await fetchIssueAttachments(apiKey, issue.id);
    } catch (err) {
      onLog(
        `! Linear attachments fetch failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      return { url: null, sawNonOpenPr: false };
    }
    return pickOpenPrUrlFromAttachments(
      attachments.map((a) => a.url),
      issue.identifier,
      cmdRunner,
      projectRoot,
      onLog,
    );
  }

  async function isChangeArchivedForIssue(issue: LinearIssue): Promise<boolean> {
    const changeName = changeNameForIssue(issue);
    const root = cwdByChange.get(changeName) ?? projectRoot;
    const archiveDir = join(projectLayout(root).tasksDir, "archive");
    let entries: string[];
    try {
      entries = await readdir(archiveDir);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return false;
      throw err;
    }
    const suffix = `-${changeName}`;
    return entries.some((name) => name === changeName || name.endsWith(suffix));
  }

  async function fetchDoneCandidates(): Promise<LinearIssue[]> {
    if (!indicators.setDone) return [];
    const include = markersOf(indicators.setDone);
    const exclude = indicators.setConflicted ? markersOf(indicators.setConflicted) : [];
    if (include.length === 0) return [];
    return fetchOpenIssues(apiKey, { team, assignee, include, exclude });
  }

  async function fetchMentions(): Promise<{ issue: LinearIssue; trigger: MentionTrigger }[]> {
    const wantMention = cfg.linear.mentionTrigger;
    const wantCodeReview = args.codeReview || cfg.linear.codeReviewTrigger;
    if (!wantMention && !wantCodeReview) return [];
    const handle = cfg.linear.mentionHandle;
    let candidates: LinearIssue[] = [];
    try {
      candidates = await fetchMentionScanIssues(apiKey, {
        team,
        assignee,
        indicators: {
          ...(indicators.getTodo !== undefined ? { getTodo: indicators.getTodo } : {}),
          ...(indicators.getInProgress !== undefined
            ? { getInProgress: indicators.getInProgress }
            : {}),
          ...(indicators.setDone !== undefined ? { setDone: indicators.setDone } : {}),
        },
      });
    } catch (err) {
      if (isRateLimitedError(err)) {
        onLog(`! mention scan: rate limited, deferring rest of scan to next poll`, "yellow");
        return [];
      }
      onLog(`! mention scan: fetchMentionScanIssues failed: ${formatLinearError(err)}`, "yellow");
      return [];
    }
    const out: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
    const queued = new Set<string>();
    let rateLimitedLogged = false;
    const logRateLimited = (): void => {
      if (rateLimitedLogged) return;
      rateLimitedLogged = true;
      onLog(`! mention scan: rate limited, deferring rest of scan to next poll`, "yellow");
    };
    for (const issue of candidates) {
      const comments = issue.comments ?? [];
      const lastRalphPickup = findLastRalphPickupISO(comments);

      if (wantMention) {
        for (const c of comments) {
          if (isRalphComment(c.body)) continue;
          if (!containsHandle(c.body, handle)) continue;
          if (lastRalphPickup && c.createdAt <= lastRalphPickup) continue;
          out.push({
            issue,
            trigger: {
              source: "linear",
              body: c.body,
              createdAt: c.createdAt,
              ...(c.user?.name ? { author: c.user.name } : {}),
              url: issue.url,
            },
          });
          try {
            await addReactionToComment(apiKey, c.id, "👀");
          } catch (err) {
            if (isRateLimitedError(err)) {
              logRateLimited();
              queued.add(issue.id);
              break;
            }
            onLog(
              `! mention scan: Linear reaction failed for ${issue.identifier}: ${formatLinearError(err)}`,
              "yellow",
            );
          }
          queued.add(issue.id);
          break;
        }
        if (rateLimitedLogged) break;
        if (queued.has(issue.id)) continue;
      }

      const prUrl = await resolvePrUrlForIssue(issue);
      if (!prUrl) continue;

      if (wantMention) {
        const ghComments = await fetchPrIssueComments(cmdRunner, projectRoot, prUrl, onLog);
        const prMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(prUrl);
        for (const c of ghComments) {
          if (!containsHandle(c.body, handle)) continue;
          if (lastRalphPickup && c.createdAt <= lastRalphPickup) continue;
          out.push({
            issue,
            trigger: {
              source: "github",
              body: c.body,
              createdAt: c.createdAt,
              ...(c.author ? { author: c.author } : {}),
              url: c.url,
            },
          });
          if (prMatch) {
            const [, owner, repo] = prMatch;
            try {
              await addGithubReactionToComment(
                cmdRunner,
                projectRoot,
                { owner: owner!, repo: repo!, kind: "issue" },
                c.id,
                "👀",
              );
            } catch (err) {
              onLog(
                `! mention scan: GitHub reaction failed for ${prUrl}: ${formatLinearError(err)}`,
                "yellow",
              );
            }
          }
          queued.add(issue.id);
          break;
        }
        if (queued.has(issue.id)) continue;
      }

      if (wantCodeReview) {
        const trigger = await scanCodeReview(issue, prUrl, lastRalphPickup, {
          cmdRunner,
          projectRoot,
          useWorktree,
          staleHours: cfg.linear.codeReviewStaleHours,
          cwdOf: (cn) => cwdByChange.get(cn),
          lastHandledReviewActivity,
          stalePingedAt,
          onLog,
        });
        if (trigger) {
          out.push({ issue, trigger });
          queued.add(issue.id);
        }
      }
    }
    return out;
  }

  async function resolvePrUrlForIssue(issue: LinearIssue): Promise<string | null> {
    const changeName = changeNameForIssue(issue);
    if (isPrUnavailable(changeName)) return null;
    const inflight = prByChange.get(changeName);
    if (inflight) return inflight;

    const cached = prUrlByIssue.get(issue.id);
    if (cached !== undefined) return cached;

    const found = await discoverPrUrl(issue, changeName);
    prUrlByIssue.set(issue.id, found);
    if (found) prByChange.set(changeName, found);
    return found;
  }

  const commentSyncEnabled = Boolean(cfg.linear.syncTasksToComment && apiKey);
  const commentMutations: CommentMutations = {
    createIssueComment,
    updateIssueComment,
    deleteIssueComment,
  };
  const specAttachmentsEnabled = Boolean(commentSyncEnabled && cfg.linear.syncSpecsAsAttachments);

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
        applyIndicator,
        applyMarker,
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
      bus: createNoopBus(),
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
  const specAttachmentMutations: SpecAttachmentMutations = {
    uploadFileToLinear,
    createAttachmentForUrl,
    deleteAttachment,
    findIssueAttachmentByTitle,
  };

  const coord = new AgentCoordinator(
    {
      beforePoll: () => {
        pollContext = new PollContext();
      },
      fetchTodo: () => fetchByGet(indicators.getTodo, excludeFromTodo),
      fetchInProgress: () => fetchByGet(indicators.getInProgress, []),
      fetchConflicted: () => fetchByGet(indicators.getConflicted, []),
      fetchReview: () => fetchByGet(indicators.getReview, excludeFromReview),
      fetchMentions,
      fetchDoneCandidates,
      prepare,
      prepareTaskForTrigger,
      spawnWorker,
      applyIndicator,
      removeIndicator,
      postComment: (issue, body) => addIssueComment(apiKey, issue.id, body),
      fetchComments: async (issueId) => {
        const c = await fetchIssueComments(apiKey, issueId);
        return c.map((x) => ({ body: x.body }));
      },
      checkPrStatus,
      isChangeArchivedForIssue,
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
      ...(commentSyncEnabled
        ? {
            syncTasks: async (worker, iteration) => {
              const root = cwdByChange.get(worker.changeName) ?? projectRoot;
              const layout = projectLayout(root);
              const changeDir = layout.changeDir(worker.changeName);
              const statePath = layout.stateFile(worker.changeName);
              await postPlanCommentOnce({
                apiKey: apiKey!,
                issueId: worker.issueId,
                statePath,
                changeDir,
                changeName: worker.changeName,
                log: onLog,
                mutations: commentMutations,
              });
              await postOrUpdateTasksComment({
                apiKey: apiKey!,
                issueId: worker.issueId,
                statePath,
                changeDir,
                changeName: worker.changeName,
                iteration,
                log: onLog,
                mutations: commentMutations,
              });
              if (specAttachmentsEnabled) {
                await syncSpecAttachments({
                  apiKey: apiKey!,
                  issueId: worker.issueId,
                  statePath,
                  changeDir,
                  iteration,
                  log: onLog,
                  mutations: specAttachmentMutations,
                  formats: cfg.linear.specAttachmentFormats,
                });
              }
            },
            onSteeringAppended: async (changeName, message) => {
              const root = cwdByChange.get(changeName) ?? projectRoot;
              const layout = projectLayout(root);
              const changeDir = layout.changeDir(changeName);
              const statePath = layout.stateFile(changeName);
              const issue = issueByChange.get(changeName) ?? null;
              const issueId = issue?.id ?? null;
              if (!issueId) {
                onLog(
                  `  comment-sync: no Linear issue cached for ${changeName}; skipping steering refresh`,
                  "gray",
                );
                return;
              }
              let iteration = 0;
              try {
                const f = Bun.file(statePath);
                if (await f.exists()) {
                  const json = (await f.json()) as { iteration?: number };
                  iteration = json.iteration ?? 0;
                }
              } catch {
                /* ignore */
              }
              await postSteeringAndRefreshTasks({
                apiKey: apiKey!,
                issueId,
                statePath,
                changeDir,
                changeName,
                iteration,
                message,
                log: onLog,
                mutations: commentMutations,
              });
            },
          }
        : {}),
    },
    {
      concurrency,
      ...(indicators.setInProgress !== undefined
        ? { setInProgress: indicators.setInProgress }
        : {}),
      ...(indicators.setDone !== undefined ? { setDone: indicators.setDone } : {}),
      ...(indicators.setError !== undefined ? { setError: indicators.setError } : {}),
      ...(indicators.setConflicted !== undefined
        ? { setConflicted: indicators.setConflicted }
        : {}),
      ...(indicators.clearConflicted !== undefined
        ? { clearConflicted: indicators.clearConflicted }
        : {}),
      ...(indicators.clearReview !== undefined ? { clearReview: indicators.clearReview } : {}),
      ...(indicators.getAutoMerge !== undefined ? { getAutoMerge: indicators.getAutoMerge } : {}),
      postComments: cfg.linear.postComments,
      commentEveryIterations: cfg.linear.updateEveryIterations,
      ...(args.maxTickets > 0 ? { maxTickets: args.maxTickets } : {}),
    },
  );

  coordRef.current = coord;

  const filterDesc = describeIndicators(indicators, team, assignee);

  const baselineCfg = cfg.preExistingErrorCheck;
  const baselineCommands = resolveBaselineCommands(cfg);
  const baselineEnabled = (args.preExistingErrorCheck ?? baselineCfg.enabled) === true;
  const baselineTeam = team;
  const runBaselineGateOnce = async (): Promise<void> => {
    if (!baselineEnabled) return;
    await runBaselineGate({
      enabled: true,
      commands: baselineCommands,
      baseBranch: baselineCfg.baseBranch,
      outputCharLimit: baselineCfg.outputCharLimit,
      cwd: projectRoot,
      cmdRunner,
      gitRunner,
      coordinator: coord,
      ...(baselineTeam && apiKey
        ? {
            linear: {
              findOpen: () => findOpenIssueByLabel(apiKey, baselineTeam, baselineCfg.label),
              create: async (title, description) => {
                const teamId = await fetchTeamIdByKey(apiKey, baselineTeam);
                if (!teamId) throw new Error("Linear team not found");
                let labelIds: string[] | undefined;
                try {
                  const labelId = await resolveLabelIdForTeam(baselineTeam, baselineCfg.label);
                  if (labelId) labelIds = [labelId];
                } catch {
                  // non-fatal
                }
                return createIssue(apiKey, {
                  teamId,
                  title,
                  description,
                  ...(labelIds ? { labelIds } : {}),
                });
              },
              updateDescription: (id, description) =>
                updateIssueDescription(apiKey, id, description),
            },
          }
        : {}),
      onLog,
    });
  };

  async function resolveLabelIdForTeam(teamKey: string, labelName: string): Promise<string | null> {
    const fakeIssue = { identifier: `${teamKey}-0` } as LinearIssue;
    return resolveLabelId(fakeIssue, labelName);
  }

  return {
    coord,
    filterDesc,
    concurrency,
    pollInterval,
    getWorkerCwd: (changeName) => cwdByChange.get(changeName),
    syncTasksEnabled: commentSyncEnabled,
    runBaselineGate: runBaselineGateOnce,
  };
}
