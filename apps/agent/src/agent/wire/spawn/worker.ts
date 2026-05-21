import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import {
  MISSION_TASKS_FILENAME,
  normalizeNewlyAppendedSectionWithReport,
} from "@ralphy/core/tasks-md";
import type { ParsedArgs } from "../../../cli";
import type { RalphyConfig } from "../../config";
import type { AgentCoordinator } from "../../coordinator";
import type { CmdRunner } from "../../pr";
import type { GitRunner } from "../../worktree";
import { issueMatchesGetIndicator, type LinearIssue } from "../../linear";
import { runPostTask, type PostTaskPhase, type PostTaskMode } from "../../post-task";
import type { QueueTrigger } from "../../coordinator";
import { defaultSpawn } from "./default";
import { traceCmdRunner, type AgentRunners } from "../runners";
import { resolveDependencyBaseBranchImpl } from "../pr-helpers";
import type { Indicators } from "@ralphy/types";

export type WorkerPhase = PostTaskPhase | "working" | "scaffolding";

interface SpawnWorkerInput {
  args: ParsedArgs;
  cfg: RalphyConfig;
  apiKey: string;
  projectRoot: string;
  statesDir: string;
  logsDir: string;
  useWorktree: boolean;
  indicators: Indicators;
  cmdRunner: CmdRunner;
  gitRunner: GitRunner;
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
  /** Apply the `clearConflicted` indicator for the issue tied to
   *  `changeName`. Invoked by `runPostTask` on the conflict-fix verify
   *  path when `fetchPrStatus` reports MERGEABLE. */
  clearConflicted?: (issue: LinearIssue) => Promise<void>;
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
    clearConflicted,
  } = input;

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
      const wantPr =
        wantPrBase &&
        !awaitingChangeSet.has(changeName) &&
        !(coordRef.current?.isAwaitingConfirmation(changeName) ?? false);
      const effectiveCode = await runPostTask(
        {
          ...(trigger ? { mode: trigger as PostTaskMode } : {}),
          ...(prByChange?.get(changeName) ? { prUrl: prByChange.get(changeName)! } : {}),
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
          registerPr: (cn, url) => onPrRegistered(cn, url),
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
          ...(clearConflicted
            ? {
                clearConflicted: async () => {
                  const issueForChange2 = issueByChange.get(changeName);
                  if (!issueForChange2) return;
                  await clearConflicted(issueForChange2);
                },
              }
            : {}),
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
  };
}
