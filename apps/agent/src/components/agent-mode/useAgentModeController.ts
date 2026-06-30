/** Data/coordination layer for the AgentMode TUI: config load, preflight,
 *  coordinator wiring, poll loop, worker-state polling, signal handling, and
 *  the file-log sink. Owns the non-UI refs/state and returns them to the
 *  component, which keeps only navigation/layout concerns. */

import { useEffect, useRef, useState } from "react";
import { useApp } from "ink";
import { VERSION, type AgentParsedArgs } from "../../cli";
import {
  type ensureRalphyConfig as ensureRalphyConfigImpl,
  type loadEffectiveConfig as loadEffectiveConfigImpl,
  type RalphyConfig,
} from "../../agent/config";
import type { PreflightResult, PreflightOptions } from "@ralphy/engine/preflight";
import { createJsonLogFileSink } from "../../agent/json-log/json-log-file";
import { waitForActiveWorkers } from "../../runtime/shutdown";
import { logSession, logCoord, logPhase } from "@ralphy/log";
import { cleanOutputLine } from "../../shared/capabilities/output-utils";
import { fetchViewer } from "../../shared/capabilities/linear-client/request";
import {
  readWorkerSnapshot,
  diffWorkerSnapshot,
  type WorkerSnapshot,
} from "../../agent/state/worker-state-poll";
import type { SystemMetrics } from "@ralphy/events";
import type { TicketRow } from "../task-pipeline";
import { useBoundedLogs, type BoundedLogs } from "../useBoundedLogs";
import { useSystemMetrics } from "../useSystemMetrics";
import { TAIL_BUFFER_SIZE } from "./agent-mode-helpers";
import {
  type AgentModeBuildCoordinator,
  type AgentModeCoordinator,
  type WorkerMeta,
} from "./agent-mode-coordinator";

const SESSION_START = new Date().toISOString();

export interface AgentModePollStatus {
  state: "idle" | "polling";
  lastAt: number | null;
  filterDesc: string;
  /** One lifecycle row per live ticket — the unified TASKS board. Refreshes
   *  at poll cadence (states change slowly); per-row liveness for the focused
   *  active card is sourced separately from `workerMetaRef`. */
  lastBoard: TicketRow[];
}

export interface AgentModeControllerInput {
  args: AgentParsedArgs;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  buildCoordinator: AgentModeBuildCoordinator;
  ensureConfig: typeof ensureRalphyConfigImpl;
  loadConfig: typeof loadEffectiveConfigImpl;
  runPreflight: (opts?: PreflightOptions) => Promise<PreflightResult>;
}

export interface AgentModeController {
  logs: BoundedLogs["logs"];
  logTrimGeneration: number;
  appendLog: BoundedLogs["appendLog"];
  sysMetrics: SystemMetrics | null;
  preflightError: { tool: string; message: string } | null;
  fatalExit: number | null;
  clock: number;
  effective: { concurrency: number; pollInterval: number } | null;
  pollStatus: AgentModePollStatus;
  authedUser: { name: string; email: string } | null;
  coordRef: React.MutableRefObject<AgentModeCoordinator | null>;
  workerMetaRef: React.MutableRefObject<Map<string, WorkerMeta>>;
  nextPollAtRef: React.MutableRefObject<number>;
  cfgRef: React.MutableRefObject<RalphyConfig | null>;
  fileEmit: (event: Record<string, unknown>) => void;
}

export function useAgentModeController({
  args,
  projectRoot,
  statesDir,
  tasksDir,
  buildCoordinator,
  ensureConfig,
  loadConfig,
  runPreflight,
}: AgentModeControllerInput): AgentModeController {
  const { exit } = useApp();
  const { logs, logTrimGeneration, appendLog } = useBoundedLogs();
  const [preflightError, setPreflightError] = useState<{ tool: string; message: string } | null>(
    null,
  );
  const [fatalExit, setFatalExit] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(0);
  const coordRef = useRef<AgentModeCoordinator | null>(null);
  const workerMetaRef = useRef<Map<string, WorkerMeta>>(new Map());
  const nextPollAtRef = useRef<number>(0);
  const cfgRef = useRef<RalphyConfig | null>(null);
  const [effective, setEffective] = useState<{ concurrency: number; pollInterval: number } | null>(
    null,
  );
  const [pollStatus, setPollStatus] = useState<AgentModePollStatus>({
    state: "idle",
    lastAt: null,
    filterDesc: "",
    lastBoard: [],
  });
  // Authenticated Linear user (owner of LINEAR_API_KEY); null until resolved or
  // when the key resolves no user — surfaced in the header so a wrong/expired
  // key is visible instead of silently matching zero tickets.
  const [authedUser, setAuthedUser] = useState<{ name: string; email: string } | null>(null);

  const fileSinkRef = useRef<ReturnType<typeof createJsonLogFileSink> | null>(null);
  if (fileSinkRef.current === null) {
    fileSinkRef.current = createJsonLogFileSink(args.jsonLogFile);
  }
  const fileEmit = (event: Record<string, unknown>): void => {
    fileSinkRef.current?.emit(event);
  };

  const { sysMetrics, sampleNow: sampleSystemMetrics } = useSystemMetrics();

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function init() {
      logSession(`=== session start ${SESSION_START} ===`);
      const cfgPath = await ensureConfig(projectRoot, args.workflowFile);
      const cfg = await loadConfig(
        projectRoot,
        args.workflowFile,
        args.overrides,
        args.agentOverrides,
      );
      cfgRef.current = cfg;
      appendLog(`agent mode v${VERSION} — config: ${cfgPath}`, "gray");

      const apiKey = process.env["LINEAR_API_KEY"];
      if (!apiKey) {
        throw new Error("LINEAR_API_KEY not set — cannot poll Linear");
      }

      const pf = await runPreflight({
        requireRepoWrite: cfg.createPrOnSuccess,
        repoCwd: projectRoot,
      });
      if (!pf.ok) {
        fileEmit({ type: "error", code: "auth_failure", tool: pf.tool, text: pf.message });
        setPreflightError({ tool: pf.tool, message: pf.message });
        setFatalExit(2);
        return;
      }

      const { coord, filterDesc, concurrency, pollInterval, runBaselineGate } = buildCoordinator({
        args,
        cfg,
        projectRoot,
        statesDir,
        tasksDir,
        apiKey,
        onLog: (text, color) => {
          const ev: Record<string, unknown> = { type: "log", text };
          if (color !== undefined) ev["color"] = color;
          fileEmit(ev);
          appendLog(text, color);
        },
        onFileLog: (text) => logCoord(text),
        onWorkersChanged: () => setTick((t) => t + 1),
        onWorkerStarted: (changeName, dir, logFile, changeDir) => {
          fileEmit({ type: "worker_started", changeName, statesDir: dir, logFile, changeDir });
          logSession(`worker-started ${changeName} log=${logFile}`, logFile);
          workerMetaRef.current.set(changeName, {
            startedAt: Date.now(),
            statesDir: dir,
            logFile,
            changeDir,
            iter: 0,
            phase: "working",
            phaseDetail: "",
            phaseStartedAt: Date.now(),
            currentTask: null,
            subtasks: [],
            taskProgress: null,
            openspecPhase: null,
            reviewRounds: 0,
            prUrl: null,
            currentCmd: null,
            tail: [],
          });
        },
        onWorkerExited: (changeName) => {
          fileEmit({ type: "worker_exited", changeName });
          const m = workerMetaRef.current.get(changeName);
          logSession(`worker-exited ${changeName}`, m?.logFile);
          workerMetaRef.current.delete(changeName);
        },
        onWorkerPhase: (changeName, phase, detail) => {
          const ev: Record<string, unknown> = { type: "worker_phase", changeName, phase };
          if (detail !== undefined) ev["detail"] = detail;
          fileEmit(ev);
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (m.phase !== phase) m.phaseStartedAt = Date.now();
          m.phase = phase;
          m.phaseDetail = detail ?? "";
          logPhase(changeName, m.logFile, phase, detail);
        },
        onWorkerOutput: (changeName, line) => {
          const clean = cleanOutputLine(line);
          if (clean) fileEmit({ type: "worker_output", changeName, line: clean });
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (!clean) return;
          m.tail.push(clean);
          if (m.tail.length > TAIL_BUFFER_SIZE) m.tail.splice(0, m.tail.length - TAIL_BUFFER_SIZE);
        },
        onWorkerCmd: (changeName, cmd, state, durationMs, ok) => {
          if (state === "start") {
            fileEmit({ type: "worker_cmd_start", changeName, cmd });
          } else {
            fileEmit({
              type: "worker_cmd_end",
              changeName,
              cmd,
              durationMs: durationMs ?? 0,
              ok: ok ?? true,
            });
          }
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (state === "start") {
            m.currentCmd = { argv: cmd, startedAt: Date.now() };
          } else {
            m.currentCmd = null;
          }
        },
        onWorkerPr: (changeName, prUrl) => {
          fileEmit({ type: "worker_pr", changeName, url: prUrl });
          const m = workerMetaRef.current.get(changeName);
          if (m) m.prUrl = prUrl;
        },
        onAwaitingTicket: (info) => {
          // The gated ticket renders inline as an `awaiting` board row; this
          // callback survives only to record the gate event in the file log.
          fileEmit({
            type: "awaiting_confirmation",
            changeName: info.changeName,
            issueIdentifier: info.issueIdentifier,
            issueUrl: info.issueUrl,
            since: info.since,
            round: info.round,
          });
        },
      });
      setEffective({ concurrency, pollInterval });

      // Resolve the authed user without blocking startup; header renders from state once it lands.
      void fetchViewer(apiKey).then((viewer) => {
        if (viewer) setAuthedUser({ name: viewer.name, email: viewer.email });
      });

      fileEmit({
        type: "started",
        version: VERSION,
        filterDesc,
        concurrency,
        pollInterval,
        configPath: cfgPath,
      });

      coordRef.current = coord;
      await coord.init();

      const tick = async () => {
        if (cancelled) return;
        fileEmit({ type: "poll_start" });
        setPollStatus((p) => ({ ...p, state: "polling", filterDesc }));
        try {
          await runBaselineGate();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          fileEmit({ type: "baseline_gate_failed", message });
          appendLog(`! baseline gate failed: ${message}`, "yellow");
        }
        if (cancelled) return;
        const { found, added, buckets, prStatus, board } = await coord.pollOnce();
        if (cancelled) return;
        const sys = await sampleSystemMetrics();
        fileEmit({ type: "poll_done", found, added, buckets, prStatus, sys });
        if (added > 0) {
          appendLog(`  ${added} new issue${added === 1 ? "" : "s"} queued (found ${found} open)`);
        }
        setPollStatus({
          state: "idle",
          lastAt: Date.now(),
          filterDesc,
          lastBoard: board,
        });
        nextPollAtRef.current = Date.now() + pollInterval * 1000;
        pollTimer = setTimeout(tick, pollInterval * 1000);
      };
      void tick();
    }

    void init().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      fileEmit({ type: "error", code: "init_failure", text: message });
      appendLog(`! ${message}`, "red");
      // The shared hold-to-close pause renders the error and waits for Enter
      // (interactive) before unmounting; the red log above stays visible.
      setFatalExit(1);
    });

    let shuttingDown = false;
    const onSig = (): void => {
      if (shuttingDown) {
        // Second signal — operator wants out now. 130 = SIGINT-style exit.
        process.exit(130);
      }
      shuttingDown = true;
      cancelled = true;
      fileEmit({ type: "stopped" });
      appendLog("stopping agent — sending SIGTERM to workers", "yellow");
      if (pollTimer) clearTimeout(pollTimer);
      let timedOut = false;
      void waitForActiveWorkers({
        stop: () => coordRef.current?.stop(),
        getActiveCount: () => coordRef.current?.activeCount ?? 0,
        onWarn: (active) => {
          appendLog(
            `! ${active} worker${active === 1 ? "" : "s"} still running after 5s — forcing exit at 10s (press Ctrl-C again to exit now)`,
            "red",
          );
        },
        onTimeout: (active) => {
          timedOut = true;
          appendLog(
            `! ${active} worker${active === 1 ? "" : "s"} did not exit within 10s — forcing process exit`,
            "red",
          );
          setTimeout(() => process.exit(1), 50);
        },
      }).then(() => {
        if (timedOut) return;
        exit();
        // Ink unmount + Linear API client may keep pending handles
        // open; force the process down so the operator actually sees
        // the shell prompt return.
        setTimeout(() => process.exit(0), 200);
      });
    };
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      coordRef.current?.stop();
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastPauseRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      void (async () => {
        const pause = coordRef.current?.getPause?.() ?? null;
        const pauseKey = pause ? `${pause.issueIdentifier}:${pause.since}` : null;
        if (pauseKey !== lastPauseRef.current) {
          if (pauseKey === null) {
            fileEmit({ type: "pause_cleared" });
          } else if (pause) {
            fileEmit({
              type: "pause_active",
              issueIdentifier: pause.issueIdentifier,
              command: pause.command,
              since: pause.since,
            });
          }
          lastPauseRef.current = pauseKey;
        }
        for (const [changeName, meta] of workerMetaRef.current) {
          const prev: WorkerSnapshot = {
            iter: meta.iter,
            reviewRounds: meta.reviewRounds,
            openspecPhase: meta.openspecPhase,
            currentTask: meta.currentTask,
            subtasks: meta.subtasks,
            taskProgress: meta.taskProgress,
          };
          const next = await readWorkerSnapshot({
            changeName,
            statesDir: meta.statesDir,
            changeDir: meta.changeDir,
            prev,
          });
          meta.iter = next.iter;
          meta.reviewRounds = next.reviewRounds;
          meta.openspecPhase = next.openspecPhase;
          meta.currentTask = next.currentTask;
          meta.subtasks = next.subtasks;
          meta.taskProgress = next.taskProgress;
          for (const ev of diffWorkerSnapshot(changeName, prev, next)) {
            fileEmit(ev);
          }
        }
        if (!cancelled) setClock((c) => c + 1);
      })();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return {
    logs,
    logTrimGeneration,
    appendLog,
    sysMetrics,
    preflightError,
    fatalExit,
    clock,
    effective,
    pollStatus,
    authedUser,
    coordRef,
    workerMetaRef,
    nextPollAtRef,
    cfgRef,
    fileEmit,
  };
}
