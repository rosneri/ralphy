import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import {
  MISSION_TASKS_FILENAME,
  normalizeNewlyAppendedSectionWithReport,
} from "@ralphy/core/tasks-md";
import type { AgentParsedArgs } from "../../../cli";
import type { RalphyConfig } from "../../config";
import type { AgentCoordinator } from "../../coordinator";
import type { CmdRunner } from "../../pr";
import type { GitRunner } from "../../worktree";
import {
  fetchIssueComments,
  issueMatchesGetIndicator,
  type LinearComment,
  type LinearIssue,
} from "../../linear";
import {
  runPostTask,
  type PostTaskInput,
  type PostTaskPhase,
  type PostTaskMode,
  type RetroDispositionInfo,
} from "../../post-task";
import type { QueueTrigger } from "../../coordinator";
import { defaultSpawn } from "./default";
import { traceCmdRunner, type AgentRunners } from "../runners";
import { resolveDependencyBaseBranchImpl } from "../pr-helpers";
import { waitForMergeability } from "../../../shared/pr/wait-for-mergeability";
import { agentRunStatePath } from "../../state/agent-run-state";
import { runRetrospective, type RetroContext } from "@ralphy/retro";
import { runEngine } from "@ralphy/engine/engine";
import type { Indicators, SetIndicator } from "@ralphy/types";
import type { Bus } from "@ralphy/events";
import { emitCapture } from "../../../runtime/coordinator";

/** Local `YYYY-MM-DD` for the retrospective filename + dedupe key. */
function localDateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build a compact ticket digest from the issue + its comments for the retro. */
function buildTicketDigest(issue: LinearIssue | null, comments: LinearComment[]): string {
  if (!issue) return "(ticket details unavailable)";
  const lines = [`Title: ${issue.title}`, "", issue.description?.trim() || "(no description)"];
  if (comments.length > 0) {
    lines.push("", "Comments:");
    for (const c of comments) {
      lines.push(`- ${c.user?.name ?? "unknown"}: ${c.body}`);
    }
  }
  return lines.join("\n");
}

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
  issueByChange: Map<string, LinearIssue>;
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
 * Build the `ralph loop task …` argv for a worker subprocess. Pure and
 * exported so the engine/model selection, conditional limit flags, and the
 * `--model`-as-flag invariant are unit-testable without spawning anything.
 * The model is passed via the explicit `--model` flag rather than positionally
 * because `--claude` consumes a trailing model token but `--codex` does not — a
 * positional would be parsed as a stray argument and abort the worker. The argv
 * always terminates with `--from-agent`.
 */
export function buildTaskCmd(
  args: AgentParsedArgs,
  cfg: RalphyConfig,
  changeName: string,
): string[] {
  const engine = args.engineSet ? args.engine : cfg.engine;
  const model = args.engineSet ? args.model : cfg.model;
  const c: string[] = [
    process.execPath,
    process.argv[1] ?? "",
    "loop",
    "task",
    "--name",
    changeName,
    "--" + engine,
    "--model",
    model,
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
  const rp = cfg.openspec.reviewPhase;
  if (rp.enabled) {
    c.push("--review-enabled");
    if (rp.maxRounds !== 1) c.push("--review-max-rounds", String(rp.maxRounds));
    if (rp.reviewerModel !== undefined) c.push("--review-model", rp.reviewerModel);
    if (rp.reviewerContextStrategy !== "fresh")
      c.push("--review-context-strategy", rp.reviewerContextStrategy);
  }
  c.push("--from-agent");
  return c;
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
  issue: LinearIssue | null;
  exitCode: number;
  useWorktree: boolean;
  wantPr: boolean;
  wantFixCi: boolean;
  wantAutoMerge: boolean;
  wantValidateOnly: boolean;
  trigger?: QueueTrigger;
  prUrl?: string;
  respawnWorker: () => Promise<number>;
}): PostTaskInput {
  const { args, cfg } = input;
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
    wantFixCi: input.wantFixCi,
    wantAutoMerge: input.wantAutoMerge,
    wantValidateOnly: input.wantValidateOnly,
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
      finalizeNoOpAsDone: cfg.finalizeNoOpAsDone,
      manualMergeWhenAutoMergeDisabled: cfg.manualMergeWhenAutoMergeDisabled,
      prDraft: cfg.prDraft,
      validateCommands: [cfg.commands.test, cfg.commands.lint, cfg.commands.typecheck].filter(
        (c): c is string => Boolean(c),
      ),
    },
    respawnWorker: input.respawnWorker,
  };
}

export type WorkerPhase = PostTaskPhase | "working" | "scaffolding";

interface SpawnWorkerInput {
  args: AgentParsedArgs;
  cfg: RalphyConfig;
  apiKey: string;
  projectRoot: string;
  statesDir: string;
  logsDir: string;
  useWorktree: boolean;
  indicators: Indicators;
  cmdRunner: CmdRunner;
  gitRunner: GitRunner;
  /** Apply a Linear set-indicator. Used to wire the additive `setPrReady`
   *  marker from the PR phase (`onPrReady`). */
  applyIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  /** Event bus — used to capture `agent_indicator_failed` when a `setPrReady`
   *  write throws, mirroring the coordinator's `setDone` failure handling. */
  bus: Bus;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  runners: AgentRunners | undefined;
  awaitingChangeSet: Set<string>;
  coordRef: { current: AgentCoordinator | null };
  cwdByChange: Map<string, string>;
  statesDirByChange: Map<string, string>;
  branchByChange: Map<string, string>;
  issueByChange: Map<string, LinearIssue>;
  /** Optional read-only view of the wire's per-change PR cache. Lets the
   *  conflict-fix verify path resolve the PR URL even when no worktree
   *  branch is tracked. */
  prByChange?: Map<string, string>;
  onPrRegistered: (changeName: string, prUrl: string) => void;
  runScript: (label: string, cmd: string, cwd: string) => Promise<void>;
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
}

export function createSpawnWorker(
  input: SpawnWorkerInput,
): (
  changeName: string,
  issue?: LinearIssue,
  trigger?: QueueTrigger,
) => { exited: Promise<number>; kill: () => void } {
  const {
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
    applyIndicator,
    bus,
    onLog,
    diag,
    runners,
    awaitingChangeSet,
    coordRef,
    cwdByChange,
    statesDirByChange,
    branchByChange,
    issueByChange,
    prByChange,
    onPrRegistered,
    runScript,
    onWorkerStarted,
    onWorkerExited,
    onWorkerPhase,
    onWorkerOutput,
    onWorkerCmd,
  } = input;

  // The post-task pipeline is the one side-effecting collaborator that can't
  // be reached through a runner fake otherwise. Resolve it once: production
  // gets the real import; tests inject a capturing fake.
  const doPostTask = input.runners?.runPostTask ?? runPostTask;

  const buildTaskCmdFor = (changeName: string): string[] => buildTaskCmd(args, cfg, changeName);

  // --agent-debug: one in-memory dedupe set shared across every worker this
  // run spawns. The closure is built once and passed to `runPostTask` only
  // when the flag is set; otherwise the dep is omitted entirely (zero cost).
  const retroSeen = new Set<string>();
  const runRetrospectiveHook = async (info: RetroDispositionInfo): Promise<void> => {
    try {
      const identifier = info.issue?.identifier ?? info.changeName;
      const prUrl = prByChange?.get(info.changeName) ?? null;
      let digest = "(ticket details unavailable)";
      if (info.issue) {
        let comments: LinearComment[] = [];
        try {
          comments = await fetchIssueComments(apiKey, info.issue.id);
        } catch {
          // Best-effort: a Linear fetch failure must not abort the retro.
        }
        digest = buildTicketDigest(info.issue, comments);
      }
      const engine = args.engineSet ? args.engine : cfg.engine;
      const model = args.engineSet ? args.model : cfg.model;
      const ctx: RetroContext = {
        identifier,
        changeName: info.changeName,
        cwd: info.cwd,
        engine,
        model,
        exitCode: info.effectiveCode,
        prUrl,
        date: localDateStamp(new Date()),
        ticketDigest: digest,
        paths: {
          changeDir: info.changeDir,
          stateFilePath: info.stateFilePath,
          logFile: join(logsDir, `${info.changeName}.log`),
          jsonLogFile: args.jsonLogFile ?? null,
          agentStateFile: agentRunStatePath(projectRoot),
        },
      };
      await runRetrospective(ctx, {
        runEngine: (opts) => runEngine(opts),
        log: onLog,
        seen: retroSeen,
      });
    } catch (err) {
      onLog(`! retrospective failed: ${(err as Error).message}`, "yellow");
    }
  };

  return function spawnWorker(
    changeName: string,
    _issue?: LinearIssue,
    trigger?: QueueTrigger,
  ): { exited: Promise<number>; kill: () => void } {
    const cwd = cwdByChange.get(changeName) ?? projectRoot;
    const injected = runners?.spawnWorker;

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

      // Detect per-task validation indicator: worker AI creates specs/validate.md during design.
      const validateSpecPath = join(workerLayout.changeDir(changeName), "specs", "validate.md");
      const hasValidateSpec = await Bun.file(validateSpecPath).exists();
      const wantValidateOnly = computeWantValidateOnly(hasValidateSpec, wantPrBase);
      if (hasValidateSpec) {
        try {
          const stateFile = workerLayout.stateFile(changeName);
          const sf = Bun.file(stateFile);
          if (await sf.exists()) {
            const stateData = JSON.parse(await sf.text()) as {
              validateOnComplete?: boolean;
              createPr?: boolean;
            };
            if (!stateData.validateOnComplete) {
              stateData.validateOnComplete = true;
              stateData.createPr = false;
              await Bun.write(stateFile, JSON.stringify(stateData, null, 2));
            }
          }
        } catch {
          // ignore state update errors
        }
      }
      try {
        const prevTasks = await prevTasksPromise;
        const nextFile = Bun.file(missionTasksPath);
        if (await nextFile.exists()) {
          const nextTasks = await nextFile.text();
          const report = normalizeNewlyAppendedSectionWithReport(prevTasks, nextTasks);
          if (report.text !== nextTasks) {
            await Bun.write(missionTasksPath, report.text);
            const sections = report.headings.map((h) => `## ${h}`).join(", ");
            diag(
              "tasks",
              `! normalized ${report.count} pre-checked item(s) in newly added section(s) ${sections}`,
              "yellow",
            );
            // The loop may have exited thinking all tasks were done because the
            // agent pre-checked items in the newly-appended section. Reset state
            // to active so the next pass actually works through those items.
            try {
              const stateFile = Bun.file(workerLayout.stateFile(changeName));
              if (await stateFile.exists()) {
                const state = JSON.parse(await stateFile.text()) as { status?: string };
                if (state.status === "completed") {
                  state.status = "active";
                  await Bun.write(
                    workerLayout.stateFile(changeName),
                    JSON.stringify(state, null, 2),
                  );
                  diag(
                    "tasks",
                    `! loop exited with pre-checked items — reactivated state, respawning`,
                    "yellow",
                  );
                  return respawn();
                }
              }
            } catch (err) {
              diag("tasks", `! state reactivation failed: ${(err as Error).message}`, "yellow");
            }
          }
        }
      } catch (err) {
        diag("tasks", `! tasks.md normalization failed: ${(err as Error).message}`, "yellow");
      }
      const wantPr = computeWantPr(
        wantPrBase,
        awaitingChangeSet.has(changeName),
        coordRef.current?.isAwaitingConfirmation(changeName) ?? false,
      );
      const effectiveCode = await doPostTask(
        buildPostTaskInput({
          args,
          cfg,
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
          wantValidateOnly,
          ...(trigger ? { trigger } : {}),
          ...(prByChange?.get(changeName) ? { prUrl: prByChange.get(changeName)! } : {}),
          respawnWorker: respawn,
        }),
        {
          cmd: tracedCmd,
          git: gitRunner,
          log: onLog,
          runScript,
          ...retroDepEntry(args.agentDebug, runRetrospectiveHook),
          registerPr: (cn, url) => onPrRegistered(cn, url),
          ...(issueForChange && indicators.setPrReady
            ? {
                onPrReady: async () => {
                  const issue = issueForChange;
                  const marker = indicators.setPrReady!;
                  try {
                    await applyIndicator(issue, marker);
                    onLog(`  ${issue.identifier}: setPrReady applied`, "gray");
                  } catch (err) {
                    onLog(
                      `! Linear setPrReady failed for ${issue.identifier}: ${(err as Error).message}`,
                      "yellow",
                    );
                    // Mirror the coordinator's setDone failure capture — never
                    // rethrow: a Linear write failure must not change the run's
                    // exit code.
                    emitCapture(bus, "agent_indicator_failed", {
                      indicator: "setPrReady",
                      issue_identifier: issue.identifier,
                      error: (err as Error).message,
                    });
                  }
                },
              }
            : {}),
          ...(onWorkerPhase && {
            onPhase: (phase: PostTaskPhase, detail?: string) =>
              onWorkerPhase(changeName, phase, detail),
          }),
          checkPrConflict: async (prUrl: string) => {
            const outcome = await waitForMergeability({
              bailOnError: true,
              probe: async () => {
                const res = await tracedCmd.run(
                  ["gh", "pr", "view", prUrl, "--json", "state,mergeable,mergeStateStatus"],
                  cwd,
                );
                return JSON.parse(res.stdout || "{}") as {
                  state?: string;
                  mergeable?: string;
                  mergeStateStatus?: string;
                };
              },
            });
            return outcome.kind === "conflicting";
          },
          resolveDependencyBaseBranch: (issue) =>
            resolveDependencyBaseBranchImpl(issue, tracedCmd, cwd, { apiKey, onLog }),
        },
      );
      releaseWorkerMaps(
        { cwdByChange, statesDirByChange, branchByChange, issueByChange },
        changeName,
      );
      onWorkerExited(changeName);
      return effectiveCode;
    });

    return { exited: wrapped, kill: () => handle.kill() };
  };
}
