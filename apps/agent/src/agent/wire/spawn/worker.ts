import { join } from "node:path";
import { workflowPath } from "@ralphy/workflow";
import { projectLayout } from "@ralphy/core/layout";
import {
  MISSION_TASKS_FILENAME,
  normalizeNewlyAppendedSectionWithReport,
} from "@ralphy/core/tasks-md";
import { snapshotCheckout, type CheckoutSnapshot } from "@ralphy/core/main-checkout-sentinel";
import type { AgentParsedArgs } from "../../../cli";
import type { RalphyConfig } from "../../config";
import type { AgentCoordinator } from "../../coordinator";
import type { CmdRunner } from "../../pr";
import type { CodeHost } from "@ralphy/codehost";
import type { GitRunner } from "../../worktree";
import { issueMatchesGetIndicator } from "../../../shared/capabilities/linear-client/filters";
import type { TrackedIssue } from "@ralphy/tracker";
import { runPostTask, type PostTaskPhase } from "../../post-task";
import type { QueueTrigger } from "../../coordinator";
import { defaultSpawn } from "./default";
import { traceCmdRunner, type AgentRunners } from "../runners";
import { resolveDependencyBaseBranchImpl } from "../pr-helpers";
import type { Indicators, SetIndicator } from "@ralphy/types";
import type { Bus } from "@ralphy/events";
import { emitCapture } from "../../../runtime/coordinator";
import {
  buildPostTaskInput,
  buildTaskCmd,
  computeWantPr,
  computeWantValidateOnly,
  releaseWorkerMaps,
  retroDepEntry,
  type WorkerPhase,
} from "./worker-helpers";
import { createRetrospectiveHook, reportCheckoutLeak } from "./spawn-worker-steps";

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
  /** The single {@link CodeHost} adapter built once in `wire.ts` (RLF-255 9a),
   *  forwarded into the post-task PR phase so it issues PR transitions through
   *  the shared instance instead of re-constructing a gh adapter per call. */
  codeHost: CodeHost;
  /** Apply a Linear set-indicator. Used to wire the additive `setPrReady`
   *  marker from the PR phase (`onPrReady`). */
  applyIndicator: (issue: TrackedIssue, ind: SetIndicator) => Promise<void>;
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
  issueByChange: Map<string, TrackedIssue>;
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
  issue?: TrackedIssue,
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
    codeHost,
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

  // Pin the worker to the main checkout's WORKFLOW.md (honoring --workflow):
  // a worktree cwd must not resolve a different config than the parent did.
  const workflowFilePath = workflowPath(projectRoot, args.workflowFile);
  const buildTaskCmdFor = (changeName: string, trigger?: QueueTrigger): string[] =>
    buildTaskCmd(args, changeName, workflowFilePath, trigger);

  // --agent-debug: one in-memory dedupe set shared across every worker this
  // run spawns. The closure is built once and passed to `runPostTask` only
  // when the flag is set; otherwise the dep is omitted entirely (zero cost).
  const retroSeen = new Set<string>();
  const runRetrospectiveHook = createRetrospectiveHook({
    apiKey,
    cfg,
    args,
    projectRoot,
    logsDir,
    prByChange,
    onLog,
    retroSeen,
  });

  return function spawnWorker(
    changeName: string,
    _issue?: TrackedIssue,
    trigger?: QueueTrigger,
  ): { exited: Promise<number>; kill: () => void } {
    const cwd = cwdByChange.get(changeName) ?? projectRoot;
    const injected = runners?.spawnWorker;

    const missionTasksPath = join(projectLayout(cwd).changeDir(changeName), MISSION_TASKS_FILENAME);
    const prevTasksPromise: Promise<string> = (async () => {
      const f = Bun.file(missionTasksPath);
      return (await f.exists()) ? await f.text() : "";
    })();

    // RLF-224 main-checkout sentinel: snapshot projectRoot's HEAD + dirtiness
    // just before the engine spawns so a worker run that leaks writes out of
    // its worktree can be detected (never repaired) once it exits. Armed only
    // when a real worktree is in use AND the worker cwd differs from the main
    // checkout — otherwise there is no separate tree to leak into.
    const guardOn = useWorktree && cwd !== projectRoot;
    const beforeSnapshotPromise: Promise<CheckoutSnapshot | null> = guardOn
      ? snapshotCheckout(projectRoot, gitRunner)
      : Promise.resolve(null);

    let logFilePath: string;
    let handle: { exited: Promise<number>; kill: () => void };
    if (injected) {
      logFilePath = join(logsDir, `${changeName}.log`);
      handle = injected(buildTaskCmdFor(changeName, trigger), cwd);
    } else {
      const r = defaultSpawn(
        changeName,
        buildTaskCmdFor(changeName, trigger),
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
      if (injected) return injected(buildTaskCmdFor(changeName, trigger), cwd).exited;
      return defaultSpawn(
        changeName,
        buildTaskCmdFor(changeName, trigger),
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

    const wantPrBase = cfg.createPrOnSuccess;
    const issueForChange = issueByChange.get(changeName);
    const wantAutoMerge = issueForChange
      ? issueMatchesGetIndicator(issueForChange, indicators.getAutoMerge)
      : false;
    const wrapped = handle.exited.then(async (code) => {
      // RLF-224: compare the main checkout against the pre-spawn snapshot before
      // anything else (including the respawn branch) so each worker generation
      // is checked exactly once. Report only — never `git restore`/`reset`, as
      // the main tree may hold the developer's own uncommitted work.
      const before = await beforeSnapshotPromise;
      await reportCheckoutLeak(before, {
        projectRoot,
        gitRunner,
        changeName,
        issueForChange,
        onLog,
        diag,
        bus,
      });
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
          wantAutoMerge,
          wantValidateOnly,
          ...(trigger ? { trigger } : {}),
          ...(prByChange?.get(changeName) ? { prUrl: prByChange.get(changeName)! } : {}),
          respawnWorker: respawn,
        }),
        {
          cmd: tracedCmd,
          git: gitRunner,
          codeHost,
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
          resolveDependencyBaseBranch: (issue) =>
            resolveDependencyBaseBranchImpl(issue, codeHost, { apiKey, onLog }),
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
