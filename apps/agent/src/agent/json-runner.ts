import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { VERSION, type AgentParsedArgs } from "../cli";
import { cleanOutputLine } from "../shared/capabilities/output-utils";
import { ensureRalphyConfig, loadEffectiveConfig } from "./config";
import { buildAgentCoordinator } from "./wire";
import { createJsonLogFileSink } from "./json-log/json-log-file";
import {
  runPreflight as runPreflightImpl,
  type PreflightResult,
  type PreflightOptions,
} from "@ralphy/engine/preflight";
import { getProcessBus } from "@ralphy/events";
import { logCoord } from "@ralphy/log";
import { createSystemMetricsSampler, formatSystemMetricsLine } from "../shared/system-metrics";
import { waitForActiveWorkers } from "../runtime/shutdown";
import {
  readWorkerSnapshot,
  diffWorkerSnapshot,
  initialWorkerSnapshot,
  type WorkerSnapshot,
} from "./state/worker-state-poll";
import { writeAgentRunState } from "./state/agent-run-state";

function makeEmit(fileSink: {
  emit(event: Record<string, unknown>): void;
}): (event: Record<string, unknown>) => void {
  return (event) => {
    const payload = { ts: Date.now(), ...event };
    process.stdout.write(JSON.stringify(payload) + "\n");
    fileSink.emit(event);
    const t = (event as { type?: unknown }).type;
    if (typeof t === "string") {
      getProcessBus().emit(payload as never);
    }
  };
}

/**
 * Run agent mode without Ink — emits one JSON object per line to stdout.
 * Suitable for scripting, CI, and programmatic consumers.
 *
 * Event types (all include a `ts` epoch-ms field):
 *   started          — emitted once after init; carries version, filterDesc, concurrency, pollInterval
 *   log              — coordinator log line; includes text and optional color hint
 *   poll_start       — beginning of a Linear poll cycle
 *   poll_done        — end of a poll cycle; includes found and added counts
 *   worker_started   — a worker subprocess has been spawned; includes changeName, statesDir, logFile, changeDir
 *   worker_exited    — a worker subprocess has finished
 *   worker_phase     — phase transition for a worker (working, scaffolding, committing, …)
 *   worker_output    — a line of stdout/stderr from the worker subprocess (ANSI stripped)
 *   worker_cmd_start — an external command (git, gh, …) started inside post-task
 *   worker_cmd_end   — that command finished; includes durationMs and ok
 *   worker_pr        — a PR URL was registered for a worker
 *   awaiting_confirmation — a ticket entered the confirmation gate this round
 *                          (one-shot per round entry; `round` is the deriver's
 *                          round counter, `since` is `confirmation.askedAt`)
 *   baseline_gate_failed — baseline gate threw during a poll cycle
 *   pause_active     — coordinator entered the baseline-broken paused state
 *   pause_cleared    — coordinator exited the paused state
 *   worker_iteration — worker advanced to a new iteration (from .ralph-state.json)
 *   worker_review_rounds — worker review-round counter changed
 *   worker_openspec_phase — worker's derived OpenSpec phase changed
 *   worker_current_task — worker's current pending tasks.md task changed
 *   stopped          — SIGINT/SIGTERM received; coordinator is stopping
 *
 * The same event set is mirrored to `--json-log-file` by the Ink TUI mode
 * (apps/agent/src/components/AgentMode.tsx) so consumers see one consistent
 * stream regardless of which mode the agent is running in.
 */
export async function runAgentJson({
  args,
  projectRoot,
  statesDir,
  tasksDir,
  runPreflight = runPreflightImpl,
}: {
  args: AgentParsedArgs;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  runPreflight?: (opts?: PreflightOptions) => Promise<PreflightResult>;
}): Promise<void> {
  await mkdir(join(homedir(), ".ralph"), { recursive: true }).catch(() => undefined);

  const fileSink = createJsonLogFileSink(args.jsonLogFile);
  const emit = makeEmit(fileSink);

  const cfgPath = await ensureRalphyConfig(projectRoot, args.workflowFile);
  const cfg = await loadEffectiveConfig(
    projectRoot,
    args.workflowFile,
    args.overrides,
    args.agentOverrides,
  );

  // Persist the JSONL log path + project metadata to
  // `~/.ralph/<basename(projectRoot)>/agent-state.json` so external tools
  // (and humans inspecting after the fact) can find the live event stream
  // without grepping the filesystem.
  await writeAgentRunState({
    projectRoot,
    configPath: cfgPath,
    team: cfg.linear.team,
    jsonLogFile: args.jsonLogFile ?? null,
    startedAt: new Date().toISOString(),
    version: VERSION,
  });

  const apiKey = process.env["LINEAR_API_KEY"];
  if (!apiKey) {
    emit({ type: "error", text: "LINEAR_API_KEY not set — cannot poll Linear" });
    process.exitCode = 1;
    return;
  }

  const pf = await runPreflight({
    requireRepoWrite: cfg.createPrOnSuccess,
    repoCwd: projectRoot,
  });
  if (!pf.ok) {
    emit({ type: "error", code: "auth_failure", tool: pf.tool, text: pf.message });
    process.exitCode = 2;
    return;
  }

  const lastEmittedRoundByChange = new Map<string, number>();
  interface WorkerEntry {
    statesDir: string;
    changeDir: string;
    snapshot: WorkerSnapshot;
  }
  const workerEntries = new Map<string, WorkerEntry>();
  const { coord, filterDesc, concurrency, pollInterval, runBaselineGate } = buildAgentCoordinator({
    args,
    cfg,
    projectRoot,
    statesDir,
    tasksDir,
    apiKey,
    onLog: (text, color) => {
      const ev: Record<string, unknown> = { type: "log", text };
      if (color !== undefined) ev["color"] = color;
      emit(ev);
    },
    onWorkersChanged: () => {},
    onWorkerStarted: (changeName, dir, logFile, changeDir) => {
      workerEntries.set(changeName, {
        statesDir: dir,
        changeDir,
        snapshot: initialWorkerSnapshot(),
      });
      emit({ type: "worker_started", changeName, statesDir: dir, logFile, changeDir });
    },
    onWorkerExited: (changeName) => {
      workerEntries.delete(changeName);
      emit({ type: "worker_exited", changeName });
    },
    onWorkerPhase: (changeName, phase, detail) => {
      const ev: Record<string, unknown> = { type: "worker_phase", changeName, phase };
      if (detail !== undefined) ev["detail"] = detail;
      emit(ev);
    },
    onWorkerOutput: (changeName, line) => {
      const clean = cleanOutputLine(line);
      if (clean) emit({ type: "worker_output", changeName, line: clean });
    },
    onWorkerCmd: (changeName, cmd, state, durationMs, ok) => {
      if (state === "start") {
        emit({ type: "worker_cmd_start", changeName, cmd });
      } else {
        emit({
          type: "worker_cmd_end",
          changeName,
          cmd,
          durationMs: durationMs ?? 0,
          ok: ok ?? true,
        });
      }
    },
    onWorkerPr: (changeName, prUrl) => {
      emit({ type: "worker_pr", changeName, url: prUrl });
    },
    onAwaitingTicket: (info) => {
      // One-shot per round-entry: only emit when this ticket's round number
      // exceeds the last value we already emitted for it. The deriver bumps
      // `rounds` on every revise comment, so each human-driven round produces
      // exactly one event.
      const last = lastEmittedRoundByChange.get(info.changeName);
      if (last !== undefined && info.round <= last) return;
      lastEmittedRoundByChange.set(info.changeName, info.round);
      emit({
        type: "awaiting_confirmation",
        changeName: info.changeName,
        issueIdentifier: info.issueIdentifier,
        issueUrl: info.issueUrl,
        since: info.since,
        round: info.round,
      });
    },
  });

  emit({
    type: "started",
    version: VERSION,
    filterDesc,
    concurrency,
    pollInterval,
    configPath: cfgPath,
  });

  await coord.init();

  let cancelled = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const systemMetricsSampler = createSystemMetricsSampler();

  const tick = async () => {
    if (cancelled) return;
    emit({ type: "poll_start" });
    try {
      await runBaselineGate();
    } catch (err) {
      emit({
        type: "baseline_gate_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (cancelled) return;
    const { found, added, buckets, prStatus, phase, flow } = await coord.pollOnce();
    if (cancelled) return;
    const sys = await systemMetricsSampler.sample();
    emit({ type: "poll_done", found, added, buckets, prStatus, phase, flow, sys });
    logCoord(formatSystemMetricsLine(sys));
    pollTimer = setTimeout(tick, pollInterval * 1000);
  };
  void tick();

  // Worker state-change watcher — mirrors AgentMode's 1s polling loop so the
  // --json-output stream carries the same iteration/phase/task transitions
  // the TUI dashboard surfaces.
  let lastPauseKey: string | null = null;
  const stateWatcher = setInterval(() => {
    if (cancelled) return;
    void (async () => {
      const pause = coord.getPause?.() ?? null;
      const pauseKey = pause ? `${pause.issueIdentifier}:${pause.since}` : null;
      if (pauseKey !== lastPauseKey) {
        if (pauseKey === null) {
          emit({ type: "pause_cleared" });
        } else if (pause) {
          emit({
            type: "pause_active",
            issueIdentifier: pause.issueIdentifier,
            command: pause.command,
            since: pause.since,
          });
        }
        lastPauseKey = pauseKey;
      }
      for (const [changeName, entry] of workerEntries) {
        const next = await readWorkerSnapshot({
          changeName,
          statesDir: entry.statesDir,
          changeDir: entry.changeDir,
          prev: entry.snapshot,
        });
        for (const ev of diffWorkerSnapshot(changeName, entry.snapshot, next)) {
          emit(ev);
        }
        entry.snapshot = next;
      }
    })();
  }, 1000);

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const onSig = (): void => {
      if (shuttingDown) {
        process.exit(130);
      }
      shuttingDown = true;
      cancelled = true;
      emit({ type: "stopped" });
      if (pollTimer) clearTimeout(pollTimer);
      clearInterval(stateWatcher);
      void waitForActiveWorkers({
        stop: () => coord.stop(),
        getActiveCount: () => coord.activeCount,
        onWarn: (active) => {
          emit({
            type: "log",
            text: `! ${active} worker(s) still running after 5s — forcing exit at 10s`,
            level: "warn",
          });
        },
        onTimeout: (active) => {
          emit({
            type: "log",
            text: `! ${active} worker(s) did not exit within 10s — forcing process exit`,
            level: "warn",
          });
          setTimeout(() => process.exit(1), 50);
        },
      }).then(() => resolve());
    };
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
  });
}
