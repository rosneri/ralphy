import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import type { ParsedArgs } from "../cli";
import type { RalphyConfig } from "./config";
import {
  fetchOpenIssues,
  addIssueComment,
  fetchIssueComments,
  fetchWorkflowStates,
  updateIssueState,
  fetchIssueLabels,
  addLabelToIssue,
  type LinearIssue,
  type LinearFilter,
} from "./linear";
import { AgentCoordinator } from "./coordinator";
import { scaffoldChangeForIssue } from "./scaffold";
import { createWorktree, seedWorktreeMcpConfig, type GitRunner } from "./worktree";
import { type CmdRunner } from "./pr";
import { runPostTask, type PostTaskPhase } from "./post-task";
import type { AgentStateStore } from "./state";

/** Phases the dashboard surfaces per worker. Superset of PostTaskPhase
 *  plus the worker-subprocess "working" phase. */
type WorkerPhase = PostTaskPhase | "working" | "scaffolding";

const bunGitRunner: GitRunner = {
  run: async (args, cwd) => {
    const proc = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const err = new Error("git command failed") as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = stderr;
      err.code = code;
      throw err;
    }
    return { stdout, stderr };
  },
};

const bunCmdRunner: CmdRunner = {
  run: async (cmd, cwd) => {
    const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const firstStderrLine = stderr.trim().split("\n")[0] ?? "";
      const summary = firstStderrLine ? `: ${firstStderrLine}` : "";
      const err = new Error(`\`${cmd.join(" ")}\` exited ${code}${summary}`) as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = stderr;
      err.code = code;
      throw err;
    }
    return { stdout, stderr };
  },
};

/**
 * Wrap a CmdRunner so each call emits start/end events. The dashboard
 * uses these to surface "currently running `gh pr checks`…" so a hung
 * external command is immediately visible (e.g. GitHub 504 hangs).
 */
function traceCmdRunner(
  base: CmdRunner,
  onStart: (cmd: string[]) => void,
  onEnd: (cmd: string[], durationMs: number, ok: boolean) => void,
): CmdRunner {
  return {
    run: async (cmd, cwd) => {
      const t0 = Date.now();
      onStart(cmd);
      try {
        const r = await base.run(cmd, cwd);
        onEnd(cmd, Date.now() - t0, true);
        return r;
      } catch (err) {
        onEnd(cmd, Date.now() - t0, false);
        throw err;
      }
    },
  };
}

interface BuildAgentCoordinatorInput {
  args: ParsedArgs;
  cfg: RalphyConfig;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  apiKey: string;
  /** Already loaded; the factory does not call store.load(). */
  store: AgentStateStore;
  /** Receive log lines for the UI. */
  onLog: (text: string, color?: string) => void;
  /** Called whenever the active-worker set changes (drives re-render). */
  onWorkersChanged: () => void;
  /** Called when a new worker subprocess starts. The UI uses `statesDir`
   *  to poll `<statesDir>/<changeName>/.ralph-state.json` for iter count. */
  onWorkerStarted: (changeName: string, statesDir: string, logFile: string) => void;
  /** Called after the post-task block resolves; UI drops the worker row. */
  onWorkerExited: (changeName: string) => void;
  /** Phase transition for a worker — dashboard renders alongside iter+elapsed. */
  onWorkerPhase?: (changeName: string, phase: WorkerPhase, detail?: string) => void;
  /** A line of stdout/stderr captured from the worker subprocess. The UI
   *  keeps a small ring buffer for display; the full stream is teed to a
   *  per-change log file at `<projectRoot>/.ralph/logs/<changeName>.log`. */
  onWorkerOutput?: (changeName: string, line: string) => void;
  /** Live shell-command tracer — fires on every `cmd.run(...)` start/end
   *  inside post-task. The dashboard uses this to show "running `gh pr
   *  checks` (12s)…" so hung externals are obvious. */
  onWorkerCmd?: (
    changeName: string,
    cmd: string[],
    state: "start" | "end",
    durationMs?: number,
    ok?: boolean,
  ) => void;
}

interface BuildAgentCoordinatorResult {
  coord: AgentCoordinator;
  /** One-line description of the active Linear filter, for the status footer. */
  filterDesc: string;
  /** Effective concurrency (CLI arg or config). */
  concurrency: number;
  /** Effective poll interval seconds. */
  pollInterval: number;
  /** Look up the working dir (worktree path or projectRoot) for an active
   *  change. Used by the iteration-count polling effect. */
  getWorkerCwd: (changeName: string) => string | undefined;
}

/**
 * Build a fully wired `AgentCoordinator`. Owns the per-change book-keeping
 * maps, the workflow-state / label resolver caches, the scaffold and
 * spawnWorker callbacks, and the post-task hand-off. Pure async — no React
 * dependencies — so the wiring can be unit-tested in isolation.
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
    store,
    onLog,
    onWorkersChanged,
    onWorkerStarted,
    onWorkerExited,
    onWorkerPhase,
    onWorkerOutput,
    onWorkerCmd,
  } = input;

  const logsDir = join(projectRoot, ".ralph", "logs");

  const concurrency = args.concurrency || cfg.concurrency;
  const pollInterval = args.pollInterval || cfg.pollIntervalSeconds;

  const inProgressName = args.inProgressStatus || cfg.linear.inProgressStatus;
  const baseStatuses = args.linearStatus.length ? args.linearStatus : cfg.linear.statuses;
  // Always include `inProgressStatus` in the effective filter when one is
  // configured, so issues left in flight by an interrupted previous run
  // are picked up again on restart. (Workers are deduped against
  // .ralph/agent-state.json, so we won't double-process.)
  const effectiveStatuses =
    inProgressName && baseStatuses.length > 0 && !baseStatuses.includes(inProgressName)
      ? [...baseStatuses, inProgressName]
      : baseStatuses;
  const filter: LinearFilter = {
    team: args.linearTeam || cfg.linear.team,
    assignee: args.linearAssignee || cfg.linear.assignee,
    statuses: effectiveStatuses,
    labels: args.linearLabel.length ? args.linearLabel : cfg.linear.labels,
  };

  const stateCache = new Map<string, Map<string, string>>();
  const labelCache = new Map<string, Map<string, string>>();
  const teamKeyOf = (issue: LinearIssue): string => issue.identifier.split("-")[0]!;

  const useWorktree = args.worktree || cfg.useWorktree;

  // Per-changeName book-keeping. The coordinator's deps callbacks read and
  // write these in tandem; they live in the factory's closure rather than
  // on the coordinator because the layout shape is wiring-specific.
  const cwdByChange = new Map<string, string>();
  const statesDirByChange = new Map<string, string>();
  const branchByChange = new Map<string, string>();
  const issueByChange = new Map<string, LinearIssue>();

  async function runScript(label: string, cmd: string, cwd: string): Promise<void> {
    onLog(`  ${label}: ${cmd}`, "gray");
    const proc = Bun.spawn({
      cmd: ["sh", "-c", cmd],
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      onLog(
        `! ${label} exited code ${code}${stderr ? `: ${stderr.trim().split("\n")[0]}` : ""}`,
        "yellow",
      );
    }
  }

  async function scaffoldCallback(issue: LinearIssue): Promise<string> {
    // The coordinator hasn't created an "active worker" entry yet (it
    // only does so once spawnWorker returns), so we can't emit phases
    // keyed by changeName here. The "▶ <id> → <change>" log line
    // already covers this transition.
    let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
    try {
      comments = await fetchIssueComments(apiKey, issue.id);
    } catch (err) {
      onLog(
        `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }

    // Decide where this change's files live:
    //  - useWorktree: scaffold inside the worktree so the loop sees them
    //  - else: scaffold in main project root
    let workerCwd = projectRoot;
    let scaffoldTasksDir = tasksDir;
    let scaffoldStatesDir = statesDir;
    let workerBranch: string | null = null;
    const probeName = issue.identifier.toLowerCase();
    if (useWorktree) {
      try {
        const wt = await createWorktree(projectRoot, probeName, bunGitRunner);
        workerCwd = wt.cwd;
        workerBranch = wt.branch;
        const wtLayout = projectLayout(wt.cwd);
        scaffoldTasksDir = wtLayout.tasksDir;
        scaffoldStatesDir = wtLayout.statesDir;
        onLog(`  ${issue.identifier} worktree: ${wt.cwd} (${wt.branch})`, "gray");
        try {
          await seedWorktreeMcpConfig(projectRoot, wt.cwd);
        } catch (err) {
          onLog(
            `! seeding .mcp.json failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
      } catch (err) {
        onLog(
          `! worktree create failed for ${issue.identifier}: ${(err as Error).message} — falling back to project root`,
          "yellow",
        );
      }
    }

    const appendPrompt = args.prompt || cfg.appendPrompt || "";
    const changeName = await scaffoldChangeForIssue(
      scaffoldTasksDir,
      scaffoldStatesDir,
      issue,
      comments,
      appendPrompt,
    );
    cwdByChange.set(changeName, workerCwd);
    statesDirByChange.set(changeName, scaffoldStatesDir);
    issueByChange.set(changeName, issue);
    if (workerBranch) branchByChange.set(changeName, workerBranch);

    if (cfg.setupScript) {
      await runScript("setup", cfg.setupScript, workerCwd);
    }

    return changeName;
  }

  function buildTaskCmdFor(changeName: string): string[] {
    const c: string[] = [
      process.execPath,
      process.argv[1] ?? "",
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
    // --max-failures default (5) is preserved by the worker; only forward
    // when CLI/config explicitly differ from the default.
    const maxFailures =
      args.maxConsecutiveFailures !== 5
        ? args.maxConsecutiveFailures
        : cfg.maxConsecutiveFailuresPerTask;
    if (maxFailures !== 5) c.push("--max-failures", String(maxFailures));
    const delay = args.delay || cfg.iterationDelaySeconds;
    if (delay > 0) c.push("--delay", String(delay));
    if (args.log || cfg.logRawStream) c.push("--log");
    if (args.verbose || cfg.taskVerbose) c.push("--verbose");
    return c;
  }

  function spawnWorker(changeName: string): { exited: Promise<number>; kill: () => void } {
    const cwd = cwdByChange.get(changeName) ?? projectRoot;
    const logFilePath = join(logsDir, `${changeName}.log`);

    // Pipe stdout/stderr through a line-buffered splitter that:
    //  1. emits each line via onWorkerOutput (UI ring buffer)
    //  2. appends to <projectRoot>/.ralph/logs/<changeName>.log
    // so users have both a live tail and a `tail -f`-able file.
    let logWriter: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
    const ensureLogWriter = async () => {
      if (logWriter) return logWriter;
      try {
        await Bun.write(logFilePath, "");
        logWriter = Bun.file(logFilePath).writer();
        return logWriter;
      } catch (err) {
        onLog(`! could not open worker log ${logFilePath}: ${(err as Error).message}`, "yellow");
        return null;
      }
    };

    async function pump(stream: ReadableStream<Uint8Array> | null, label: string): Promise<void> {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const writer = await ensureLogWriter();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (writer) writer.write(line + "\n");
            if (line) onWorkerOutput?.(changeName, label === "err" ? `! ${line}` : line);
          }
        }
        if (buf) {
          if (writer) writer.write(buf + "\n");
          onWorkerOutput?.(changeName, label === "err" ? `! ${buf}` : buf);
        }
      } catch {
        /* stream errors are non-fatal — the subprocess exit drives control flow */
      } finally {
        try {
          writer?.flush();
        } catch {
          /* ignore */
        }
      }
    }

    const launch = (note?: string) => {
      const p = Bun.spawn({
        cmd: buildTaskCmdFor(changeName),
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      if (note && logWriter) logWriter.write(`\n--- ${note} ---\n`);
      void pump(p.stdout as ReadableStream<Uint8Array>, "out");
      void pump(p.stderr as ReadableStream<Uint8Array>, "err");
      return p;
    };

    const respawn = (): Promise<number> => {
      onWorkerPhase?.(changeName, "working", "respawn");
      const rp = launch(`respawn at ${new Date().toISOString()}`);
      return rp.exited;
    };
    const proc = launch(`spawn at ${new Date().toISOString()}`);
    onWorkerStarted(changeName, statesDirByChange.get(changeName) ?? statesDir, logFilePath);
    onWorkerPhase?.(changeName, "working");

    const tracedCmd = onWorkerCmd
      ? traceCmdRunner(
          bunCmdRunner,
          (cmd) => onWorkerCmd(changeName, cmd, "start"),
          (cmd, ms, ok) => onWorkerCmd(changeName, cmd, "end", ms, ok),
        )
      : bunCmdRunner;

    const wantPr = args.createPr || cfg.createPrOnSuccess;
    const wantFixCi = args.fixCi || cfg.fixCiOnFailure;
    const wrapped = proc.exited.then(async (code) => {
      const workerLayout = projectLayout(cwd);
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
          cfg: {
            teardownScript: cfg.teardownScript ?? null,
            prBaseBranch: cfg.prBaseBranch,
            maxCiFixAttempts: cfg.maxCiFixAttempts,
            ciPollIntervalSeconds: cfg.ciPollIntervalSeconds,
            cleanupWorktreeOnSuccess: cfg.cleanupWorktreeOnSuccess,
          },
          respawnWorker: respawn,
        },
        {
          cmd: tracedCmd,
          git: bunGitRunner,
          log: onLog,
          runScript,
          ...(onWorkerPhase && {
            onPhase: (phase: PostTaskPhase, detail?: string) =>
              onWorkerPhase(changeName, phase, detail),
          }),
        },
      );
      try {
        logWriter?.flush();
        await logWriter?.end();
      } catch {
        /* ignore */
      }
      cwdByChange.delete(changeName);
      statesDirByChange.delete(changeName);
      branchByChange.delete(changeName);
      issueByChange.delete(changeName);
      onWorkerExited(changeName);
      return effectiveCode;
    });

    return { exited: wrapped, kill: () => proc.kill() };
  }

  const coord = new AgentCoordinator(
    {
      fetchIssues: (f) => fetchOpenIssues(apiKey, f),
      scaffold: scaffoldCallback,
      spawnWorker,
      store,
      onLog,
      onWorkersChanged,
      getIterationCount: async (changeName) => {
        const root = cwdByChange.get(changeName) ?? projectRoot;
        const file = Bun.file(projectLayout(root).stateFile(changeName));
        if (!(await file.exists())) return 0;
        const json = (await file.json()) as { iteration?: number };
        return json.iteration ?? 0;
      },
      updater: {
        postComment: (issue, body) => addIssueComment(apiKey, issue.id, body),
        setState: (issue, stateId) => updateIssueState(apiKey, issue.id, stateId),
        resolveStateId: async (issue, stateName) => {
          const team = teamKeyOf(issue);
          let map = stateCache.get(team);
          if (!map) {
            const states = await fetchWorkflowStates(apiKey, team);
            map = new Map(states.map((s) => [s.name.toLowerCase(), s.id]));
            stateCache.set(team, map);
          }
          return map.get(stateName.toLowerCase()) ?? null;
        },
        addLabel: (issue, labelId) => addLabelToIssue(apiKey, issue.id, labelId),
        resolveLabelId: async (issue, labelName) => {
          const team = teamKeyOf(issue);
          let map = labelCache.get(team);
          if (!map) {
            const labels = await fetchIssueLabels(apiKey, team);
            map = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
            labelCache.set(team, map);
          }
          return map.get(labelName.toLowerCase()) ?? null;
        },
      },
    },
    {
      concurrency,
      filter,
      inProgressStatus: args.inProgressStatus || cfg.linear.inProgressStatus,
      doneStatus: args.doneStatus || cfg.linear.doneStatus,
      doneLabel: args.doneLabel || cfg.linear.doneLabel,
      postComments: cfg.linear.postComments,
      commentEveryIterations: cfg.linear.updateEveryIterations,
    },
  );

  const filterDesc =
    `team=${filter.team ?? "*"}, assignee=${filter.assignee ?? "*"}, statuses=` +
    `${filter.statuses?.length ? filter.statuses.join(",") : "open"}` +
    `${filter.labels?.length ? `, labels=${filter.labels.join(",")}` : ""}`;

  return {
    coord,
    filterDesc,
    concurrency,
    pollInterval,
    getWorkerCwd: (changeName) => cwdByChange.get(changeName),
  };
}
