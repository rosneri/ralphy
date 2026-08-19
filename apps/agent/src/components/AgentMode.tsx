import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, Transform, useApp, useInput, useStdin } from "ink";
import { join } from "node:path";
import { VERSION, type AgentParsedArgs } from "../cli";
import {
  ensureRalphyConfig as ensureRalphyConfigImpl,
  loadEffectiveConfig as loadEffectiveConfigImpl,
  type RalphyConfig,
} from "../agent/config";
import type { ActiveWorker, PauseState, PollResult } from "../agent/coordinator";
import { buildAgentCoordinator as buildAgentCoordinatorImpl } from "../agent/wire";
import {
  runPreflight as runPreflightImpl,
  type PreflightResult,
  type PreflightOptions,
} from "@ralphy/engine/preflight";
import { applyTokenadeEnvironment } from "@ralphy/engine/tokenade";
import { createJsonLogFileSink } from "../agent/json-log/json-log-file";
import { waitForActiveWorkers } from "../runtime/shutdown";
import {
  pipelineStages,
  statusLabel,
  buildBoardTree,
  orderActiveWorkersFirst,
  STATUS_GLYPH,
  PIPELINE_NODES,
  type TicketRow,
  type PipelineNode,
  type PipelineNodeStatus,
} from "./task-pipeline";

/** Structural subset of {@link AgentCoordinator} that AgentMode actually uses.
 *  Exported so tests can supply lightweight mocks without bypassing types. */
export interface AgentModeCoordinator {
  init(): Promise<void>;
  pollOnce(): Promise<PollResult>;
  stop(): void;
  readonly activeWorkers: readonly ActiveWorker[];
  readonly activeCount: number;
  readonly queuedCount: number;
  getPause(): PauseState | null;
  restartWorker(changeName: string): Promise<boolean>;
  notifySteeringAppended?(changeName: string, message: string): Promise<void>;
}

/** Builder function shape the AgentMode component depends on. The real
 *  {@link buildAgentCoordinatorImpl} satisfies this because `AgentCoordinator`
 *  is assignable to {@link AgentModeCoordinator}. */
export type AgentModeBuildCoordinator = (
  input: Parameters<typeof buildAgentCoordinatorImpl>[0],
) => {
  coord: AgentModeCoordinator;
  filterDesc: string;
  concurrency: number;
  pollInterval: number;
  getWorkerCwd: (changeName: string) => string | undefined;
  runBaselineGate: () => Promise<void>;
};
import {
  phasePipeline,
  shouldShowPhasePipeline,
  shouldShowProgressBar,
  shouldShowSubtasksPanel,
  type OpenSpecPhase,
} from "@ralphy/core/openspec-phase";
import { logSession, logCoord, logPhase } from "@ralphy/log";
import { useTerminalSize } from "@ralphy/ui-shared/useTerminalSize";
import { useHoldToClose } from "@ralphy/ui-shared/useHoldToClose";
import { SteeringField } from "./SteeringField";
import { appendSteeringMessage } from "@ralphy/core/loop";
import { useBoundedLogs } from "./useBoundedLogs";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { cleanOutputLine } from "../shared/capabilities/output-utils";
import { fetchViewer } from "../shared/capabilities/linear-client";
import { useSystemMetrics } from "./useSystemMetrics";
import { SystemMetricsLine } from "./SystemMetricsLine";
import { fmtElapsed, modeBadge, prLabel, trunc } from "./agent-mode-format";
import {
  readWorkerSnapshot,
  diffWorkerSnapshot,
  type WorkerSnapshot,
} from "../agent/state/worker-state-poll";

/**
 * Append a steering message to the change's steering.md, wrapped in a default
 * context so the underlying storage helpers in `@ralphy/core` have an active
 * AsyncLocalStorage scope (mirroring the sidecar's `/steer` route).
 */
async function appendSteeringImpl(changeDir: string, message: string): Promise<void> {
  await runWithContext(createDefaultContext(), async () => {
    appendSteeringMessage(changeDir, message);
  });
}

interface AgentModeProps {
  args: AgentParsedArgs;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  /** Test injection — defaults to the real `appendSteering` helper. */
  appendSteering?: (changeDir: string, message: string) => Promise<void>;
  /** Test injection — defaults to the real `buildAgentCoordinator`. */
  buildCoordinator?: AgentModeBuildCoordinator;
  /** Test injection — defaults to the real `ensureRalphyConfig`. */
  ensureConfig?: typeof ensureRalphyConfigImpl;
  /** Test injection — defaults to the real `loadEffectiveConfig`. */
  loadConfig?: typeof loadEffectiveConfigImpl;
  /** Test injection — defaults to the real `runPreflight`. */
  runPreflight?: (opts?: PreflightOptions) => Promise<PreflightResult>;
}

interface WorkerMeta {
  startedAt: number;
  statesDir: string;
  logFile: string;
  changeDir: string;
  iter: number;
  phase: string;
  phaseDetail: string;
  phaseStartedAt: number;
  currentTask: string | null;
  subtasks: Array<{ done: boolean; text: string }>;
  taskProgress: { checked: number; total: number } | null;
  openspecPhase: OpenSpecPhase | null;
  reviewRounds: number;
  prUrl: string | null;
  currentCmd: { argv: string[]; startedAt: number } | null;
  tail: string[];
}

const TAIL_BUFFER_SIZE = 30;
const CMD_DISPLAY_MAX = 80;
const MAX_PENDING_DISPLAY = 15;
/** Max ticket rows the board renders before overflowing the rest into a compact
 *  horizontal identifier strip. Ctrl+F (full screen) raises this to fill the
 *  terminal height. */
const MAX_BOARD_ROWS = 10;

/**
 * Reorder subtasks for the capped SUBTASKS panel: unchecked items first,
 * then completed items, each group stable in file order. Because
 * `prependFixTask` always adds new sections at the top of `tasks.md`, the
 * newest unchecked task (e.g. `Fix failing CI checks`) ends up at row 1 of
 * the panel, and the `+N more` ellipsis only ever truncates completed
 * items. The expanded view (`Ctrl+L`) bypasses this and renders
 * everything in literal file order.
 */
export function orderSubtasksForCappedDisplay<T extends { done: boolean }>(
  subtasks: readonly T[],
): T[] {
  const pending: T[] = [];
  const done: T[] = [];
  for (const s of subtasks) (s.done ? done : pending).push(s);
  return [...pending, ...done];
}

function fmtCmd(argv: string[]): string {
  const joined = argv.join(" ");
  return joined.length > CMD_DISPLAY_MAX ? joined.slice(0, CMD_DISPLAY_MAX - 1) + "…" : joined;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Board states that imply a worker should be running. A row in one of these
 *  with no active worker is waiting for a worker slot — surfaced as a "waiting
 *  for worker" mark in place of the (meaningless, not-yet-ticking) age timer. */
const WORKER_WAIT_STATES = new Set<TicketRow["state"]>([
  "queued",
  "working",
  "in-progress",
  "conflict-fix",
  "ci-fix",
  "review",
]);

/** Board states that are advancing on their own — a live/imminent worker or an
 *  automated PR/CI step. A board with none of these and no startable todo is
 *  stalled: everything left is blocked, gated (awaiting), or bailed. */
const ADVANCING_STATES = new Set<TicketRow["state"]>([
  "queued",
  "working",
  "in-progress",
  "conflict-fix",
  "ci-fix",
  "review",
  "awaiting-ci",
]);

function calcProgressBar(
  checked: number,
  total: number,
  width: number,
): {
  countStr: string;
  filledLeft: number;
  leftSlot: number;
  filledRight: number;
  rightSlot: number;
} | null {
  const countStr = `${checked}/${total}`;
  const inner = width - 2; // for [ and ]
  if (inner < countStr.length + 2) return null;
  const leftSlot = Math.floor((inner - countStr.length) / 2);
  const rightSlot = Math.max(0, inner - countStr.length - leftSlot);
  const filled = total > 0 ? Math.round((checked / total) * inner) : 0;
  const filledLeft = Math.min(filled, leftSlot);
  const filledRight = Math.max(0, Math.min(filled - leftSlot - countStr.length, rightSlot));
  return { countStr, filledLeft, leftSlot, filledRight, rightSlot };
}

/** Tmux mangles OSC 8 sequences — skip hyperlinks inside tmux. */
const HYPERLINKS_SUPPORTED = !process.env["TMUX"];

/** Box with a centered label embedded in the top border: ╭─── LABEL ───╮ */
function LabeledBox({
  label,
  labelNode,
  labelVisualWidth,
  borderColor = "gray",
  width,
  children,
  ...rest
}: {
  label?: string;
  labelNode?: React.ReactNode;
  labelVisualWidth?: number;
  borderColor?: string;
  width: number;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Box>, "borderStyle" | "borderTop" | "borderColor" | "width">) {
  const innerWidth = Math.max(0, width - 2);
  const visualLen = labelVisualWidth ?? (label ? label.length + 2 : 0);
  const dashes = Math.max(0, innerWidth - visualLen);
  const left = Math.floor(dashes / 2);
  const right = dashes - left;
  return (
    <Box flexDirection="column" width={width}>
      {labelNode ? (
        <Box flexDirection="row">
          <Text color={borderColor}>{`╭${"─".repeat(left)}`}</Text>
          {labelNode}
          <Text color={borderColor}>{`${"─".repeat(right)}╮`}</Text>
        </Box>
      ) : (
        <Text
          color={borderColor}
        >{`╭${"─".repeat(left)} ${label ?? ""} ${"─".repeat(right)}╮`}</Text>
      )}
      <Box borderStyle="round" borderTop={false} borderColor={borderColor} width={width} {...rest}>
        {children}
      </Box>
    </Box>
  );
}

/** Renders label as an OSC 8 terminal hyperlink via Transform (so Ink measures only the label width). */
function Link({ url, label, color }: { url: string; label: string; color: string }) {
  if (!HYPERLINKS_SUPPORTED) return <Text color={color}>{label}</Text>;
  return (
    <Transform transform={(output) => `\x1b]8;;${url}\x07${output}\x1b]8;;\x07`}>
      <Text color={color} underline>
        {label}
      </Text>
    </Transform>
  );
}

function phaseColor(phase: string): string {
  switch (phase) {
    case "working":
      return "cyan";
    case "scaffolding":
      return "magenta";
    case "pushing":
    case "push-retry":
    case "rebasing":
    case "pr-create":
      return "yellow";
    case "ci-poll":
    case "ci-fix":
      return "blue";
    case "auto-merge-enabled":
      return "green";
    case "teardown":
    case "cleanup":
      return "gray";
    case "done":
      return "green";
    case "gave-up":
      return "red";
    default:
      return "white";
  }
}

function openspecPhaseColor(phase: OpenSpecPhase): string {
  switch (phase) {
    case "proposal":
      return "magenta";
    case "design":
      return "blue";
    case "tasks":
      return "cyan";
    case "implement":
      return "yellow";
    case "review":
      return "magenta";
    case "done":
      return "green";
  }
}

function workerBorderColor(phase: string): string {
  switch (phase) {
    case "working":
    case "scaffolding":
      return "cyan";
    case "pushing":
    case "push-retry":
    case "rebasing":
    case "pr-create":
      return "yellow";
    case "ci-poll":
    case "ci-fix":
      return "blue";
    case "done":
      return "green";
    case "gave-up":
      return "red";
    default:
      return "gray";
  }
}

/** Tail-line budget for the single focused active card, scaled to how many
 *  rows the board occupies above it so the OUTPUT feed fills the rest. */
function focusedCardTailLines(termHeight: number, fixedOverhead: number): number {
  return Math.max(3, termHeight - fixedOverhead);
}

/** Human-readable lifecycle node labels, in pipeline order. */
const NODE_LABELS: Record<PipelineNode, string> = {
  todo: "todo",
  confirmation: "conf",
  work: "work",
  PR: "PR",
  CI: "CI",
  done: "done",
};
/** Each node's glyph/label is centered in this many columns so the header
 *  labels line up over the row glyphs even when a glyph is double-width. */
const NODE_CELL_WIDTH = 4;
const PIPELINE_CONNECTOR = "──";

function glyphColor(status: PipelineNodeStatus): string {
  switch (status) {
    case "done":
      return "green";
    case "current":
      return "cyan";
    case "pending":
      return "gray";
    case "failed":
      return "red";
    case "bailed":
      return "magenta";
  }
}

/**
 * Render the six pipeline cells — either the node labels (header row) or the
 * per-status glyphs (a ticket row). Both modes use identical cell widths and
 * connectors, so the header labels align over the glyphs in every row.
 */
function PipelineCells({
  glyphs,
}: {
  /** Per-node statuses to render as glyphs, or `null` to render the labels. */
  glyphs: PipelineNodeStatus[] | null;
}) {
  return (
    <Box>
      {PIPELINE_NODES.map((node, i) => {
        const isHeader = glyphs === null;
        const status = isHeader ? null : glyphs[i]!;
        const content = isHeader ? NODE_LABELS[node] : STATUS_GLYPH[status!];
        return (
          <Box key={node}>
            {i > 0 && <Text dimColor>{PIPELINE_CONNECTOR}</Text>}
            <Box width={NODE_CELL_WIDTH} justifyContent="center">
              {isHeader ? (
                <Text dimColor>{content}</Text>
              ) : (
                <Text color={glyphColor(status!)}>{content}</Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

const SESSION_START = new Date().toISOString();

export function AgentMode({
  args,
  projectRoot,
  statesDir,
  tasksDir,
  appendSteering = appendSteeringImpl,
  buildCoordinator = buildAgentCoordinatorImpl,
  ensureConfig = ensureRalphyConfigImpl,
  loadConfig = loadEffectiveConfigImpl,
  runPreflight = runPreflightImpl,
}: AgentModeProps) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { columns, rows, resizeKey } = useTerminalSize();
  const { logs, logTrimGeneration, appendLog } = useBoundedLogs();
  const [preflightError, setPreflightError] = useState<{ tool: string; message: string } | null>(
    null,
  );
  // Set to the intended exit code when the agent hits an unrecoverable error
  // (failed preflight, init throw). Drives the shared hold-to-close pause so the
  // reason stays on screen until the operator presses Enter — the same
  // mechanism the task loop uses. `heldRef` records whether we actually paused
  // (interactive TTY) so we can exit clean on acknowledgment and let the tmux
  // crash fallback stay quiet, versus surfacing the real code on an immediate
  // (non-interactive) close.
  const [fatalExit, setFatalExit] = useState<number | null>(null);
  const heldRef = useRef(false);
  const { awaitingClose } = useHoldToClose({
    finished: fatalExit !== null,
    hold: true,
    onClose: () => {
      // Acknowledged in-app → exit clean so the tmux crash fallback stays quiet;
      // closed immediately (no TTY) → surface the real failure code.
      const code = heldRef.current ? 0 : (fatalExit ?? 0);
      setTimeout(() => process.exit(code), 200);
    },
  });
  useEffect(() => {
    if (awaitingClose) heldRef.current = true;
  }, [awaitingClose]);
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(0);
  /** Id of the focused board ticket. Null until the first navigation; the
   *  render clamps a null/missing id to the first board row. Focus is by id,
   *  not index, so it survives rows being added/removed/reordered between
   *  polls. */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** Toggled by Ctrl+T — show the focused worker's pending tasks at the bottom of its card. */
  const [showPendingTasks, setShowPendingTasks] = useState(false);
  /** Toggled by Ctrl+L — expand subtasks over the OUTPUT feed (no cap). */
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  /** Toggled by Ctrl+F — the TASKS board takes the whole screen, showing every
   *  ticket as a full row (capped at terminal height) instead of the 10-row cap. */
  const [boardFullScreen, setBoardFullScreen] = useState(false);
  /** Toggled by Ctrl+W — the active (working) ticket's card takes the whole
   *  screen: pipeline + a tall OUTPUT tail, with the board hidden. */
  const [cardFullScreen, setCardFullScreen] = useState(false);
  const coordRef = useRef<AgentModeCoordinator | null>(null);
  const workerMetaRef = useRef<Map<string, WorkerMeta>>(new Map());
  const nextPollAtRef = useRef<number>(0);
  const cfgRef = useRef<RalphyConfig | null>(null);
  const [effective, setEffective] = useState<{ concurrency: number; pollInterval: number } | null>(
    null,
  );
  const [pollStatus, setPollStatus] = useState<{
    state: "idle" | "polling";
    lastAt: number | null;
    filterDesc: string;
    /** One lifecycle row per live ticket — the unified TASKS board. Refreshes
     *  at poll cadence (states change slowly); per-row liveness for the focused
     *  active card is sourced separately from `workerMetaRef`. */
    lastBoard: TicketRow[];
  }>({
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

      // Publish Tokenade's env before the first worker spawns — engine
      // processes copy `process.env` at spawn time, so this has to land ahead
      // of them.
      applyTokenadeEnvironment(cfg.tokenade);

      const pf = await runPreflight({
        requireRepoWrite: cfg.createPrOnSuccess,
        repoCwd: projectRoot,
        tokenade: { enabled: cfg.tokenade.enabled, required: cfg.tokenade.required },
        onWarning: (text) => appendLog(`! ${text}`, "yellow"),
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

  const coord = coordRef.current;
  const cfg = cfgRef.current;
  const spinnerFrame = SPINNER_FRAMES[clock % SPINNER_FRAMES.length]!;
  const now = Date.now();
  const secsToNextPoll = nextPollAtRef.current
    ? Math.max(0, Math.ceil((nextPollAtRef.current - now) / 1000))
    : null;
  // Liveness for the TASKS box header — poll state + next-poll countdown, no
  // spinner (the header is a static border line).
  const pollState =
    pollStatus.state === "polling" ? "polling…" : pollStatus.lastAt !== null ? "idle" : "starting…";
  const tasksLiveness = `${pollState}${secsToNextPoll !== null ? ` · ${secsToNextPoll}s ↻` : ""}`;
  const activeCount = coord?.activeCount ?? 0;
  const termWidth = columns - 2;
  const termHeight = rows;

  // The board (one row per live ticket) is the navigable list. Focus is by id;
  // recompute the index each render and clamp a null/missing id to the first
  // row, so focus survives rows being added/removed/reordered between polls.
  const board = pollStatus.lastBoard;
  // Dependency-ordered view of the board: rows with a live worker are pinned to
  // the top, then blocked rows nest under their in-board blockers. This is the
  // rendered AND navigable order, so ↑/↓ move along what the user sees.
  const liveWorkerIds = new Set(coordRef.current?.activeWorkers.map((w) => w.issueId) ?? []);
  const tree = buildBoardTree(orderActiveWorkersFirst(board, liveWorkerIds));
  const focusedIndex = (() => {
    if (tree.length === 0) return -1;
    const i = tree.findIndex((t) => t.row.id === focusedId);
    return i >= 0 ? i : 0;
  })();
  const focusedRow = focusedIndex >= 0 ? tree[focusedIndex]!.row : undefined;
  // Box 4 renders the focused row's detail. If that row maps to a live worker
  // it gets the full active card; otherwise it is parked and gets a compact
  // read-only card. Liveness (this lookup) is the one place we cross the
  // poll-cadence board with the live worker set.
  const focusedWorker = focusedRow
    ? coordRef.current?.activeWorkers.find((w) => w.issueId === focusedRow.id)
    : undefined;

  // Board windowing: render at most `boardCap` ticket rows (10, or terminal-tall
  // when full-screen), scrolling so the focused row stays visible; every ticket
  // that doesn't get a full row is listed by identifier in a horizontal strip.
  const boardCap = boardFullScreen
    ? Math.max(MAX_BOARD_ROWS, termHeight - 9)
    : Math.min(MAX_BOARD_ROWS, tree.length);
  const winStart = (() => {
    if (tree.length <= boardCap || focusedIndex < 0) return 0;
    if (focusedIndex < boardCap) return 0;
    return Math.min(focusedIndex - boardCap + 1, tree.length - boardCap);
  })();
  const visibleTree = tree.slice(winStart, winStart + boardCap);
  const hiddenIdentifiers = tree
    .filter((_, i) => i < winStart || i >= winStart + boardCap)
    .map((t) => t.row.identifier);

  const steeringFocusedRef = useRef(false);
  // Resize-survival mirrors: SteeringField may be re-mounted by the
  // resizeKey-keyed Box below, so we persist its state in refs here and
  // re-seed via the initial* props on remount.
  const steeringBufferRef = useRef<string>("");
  const steeringCursorRef = useRef<number>(0);
  const steeringFocusedInitRef = useRef<boolean>(false);
  useInput(
    (input, key) => {
      if (steeringFocusedRef.current) return;
      if (key.ctrl && (input === "l" || input === "L")) {
        if (activeCount > 0) setShowAllSubtasks((v) => !v);
        return;
      }
      if (key.ctrl && (input === "t" || input === "T")) {
        if (activeCount > 0) setShowPendingTasks((v) => !v);
        return;
      }
      if (key.ctrl && (input === "f" || input === "F")) {
        setBoardFullScreen((v) => !v);
        setCardFullScreen(false);
        return;
      }
      if (key.ctrl && (input === "w" || input === "W")) {
        // Full-screen the working ticket's card. Keep focus if it is already a
        // live worker, else jump to the first active (working) one.
        const workers = coordRef.current?.activeWorkers ?? [];
        if (workers.length === 0) return;
        if (!workers.some((wk) => wk.issueId === focusedId)) setFocusedId(workers[0]!.issueId);
        setCardFullScreen((v) => !v);
        setBoardFullScreen(false);
        return;
      }
      if (tree.length === 0) return;
      const idx = focusedIndex < 0 ? 0 : focusedIndex;
      if (key.tab || key.downArrow) {
        setFocusedId(tree[(idx + 1) % tree.length]!.row.id);
      } else if (key.upArrow) {
        setFocusedId(tree[(idx - 1 + tree.length) % tree.length]!.row.id);
      } else {
        const n = parseInt(input, 10);
        if (!isNaN(n) && n >= 0 && n <= Math.min(9, tree.length - 1)) setFocusedId(tree[n]!.row.id);
      }
    },
    { isActive: isRawModeSupported && board.length > 0 },
  );

  // Full-screen gives the board the whole terminal: the focused card and
  // steering field are hidden so every reserved line goes to ticket rows.
  const steeringActive = isRawModeSupported && focusedWorker !== undefined && !boardFullScreen;

  // Estimated wrapped-line count of the overflow identifier strip (0 when every
  // ticket has a full row), so the OUTPUT tail budget below stays accurate.
  const overflowStripLines =
    hiddenIdentifiers.length === 0
      ? 0
      : Math.max(
          1,
          Math.ceil((hiddenIdentifiers.join(" · ").length + 8) / Math.max(20, termWidth)),
        );

  // Height budget for the focused active card's OUTPUT tail. Logs flow into
  // terminal scrollback via <Static>, so the live region is:
  //   header-box(5) + tasks-box(4 + one line per visible row + overflow strip,
  //   hidden when card is full-screen) + card-non-tail(8, hidden when board is
  //   full-screen) + steering(3 when shown). Card full-screen frees the whole
  //   board budget for the OUTPUT tail.
  const steeringBoxLines = steeringActive ? 3 : 0;
  const boardHidden = cardFullScreen && focusedWorker !== undefined;
  const boardOverhead = boardHidden ? 0 : 4 + visibleTree.length + overflowStripLines;
  const cardOverhead = boardFullScreen ? 0 : 8;
  const FIXED_OVERHEAD = 5 + boardOverhead + cardOverhead + steeringBoxLines;
  const focusedTailLines = focusedCardTailLines(termHeight, FIXED_OVERHEAD);

  if (preflightError) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>
          ✖ Preflight failed — {preflightError.tool}
        </Text>
        <Text color="red">{preflightError.message}</Text>
        {awaitingClose && <Text color="cyan">{"\n"}Press Enter to close…</Text>}
      </Box>
    );
  }

  return (
    <Box key={resizeKey} flexDirection="column">
      {/* ── Scrolling log history ──────────────────────────────
          Rendered via <Static> so each line is permanently flushed
          to stdout above the live UI. The terminal's native scrollback owns
          full history; the in-memory array is bounded (appendBounded) to keep
          a long run from growing memory unboundedly, and <Static> is remounted
          on trim so it keeps flushing new lines past the cap. */}
      <Static key={`logs-${logTrimGeneration}`} items={logs}>
        {(line) => (
          <Text key={line.id}>
            <Text dimColor>{line.timestamp} </Text>
            {line.color ? <Text color={line.color}>{line.text}</Text> : line.text}
          </Text>
        )}
      </Static>

      <Box flexDirection="column" marginTop={0}>
        {(() => {
          const pause = coordRef.current?.getPause?.() ?? null;
          if (!pause) return null;
          const seconds = Math.floor((Date.now() - pause.since) / 1000);
          const duration =
            seconds < 60
              ? `${seconds}s`
              : seconds < 3600
                ? `${Math.floor(seconds / 60)}m`
                : `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
          return (
            <Box borderStyle="round" borderColor="red" paddingX={1} width={termWidth}>
              <Text color="red" bold>
                ⛔ BASELINE BROKEN {pause.issueIdentifier} · {duration} · `{pause.command}`
              </Text>
            </Box>
          );
        })()}
        {/* ── Settings header — two compact text lines ─────────── */}
        <LabeledBox
          label="◈ RALPH AGENT"
          borderColor="blue"
          width={termWidth}
          paddingX={1}
          flexDirection="column"
        >
          {/* Line 1: key settings */}
          <Text>
            <Text dimColor>v{VERSION}</Text>
            {cfg && (
              <Text>
                <Text dimColor> │ </Text>
                <Text color="cyan" bold>
                  {cfg.engine}/{cfg.model}
                </Text>
                <Text dimColor> │ ×{effective?.concurrency ?? cfg.concurrency}</Text>
                <Text dimColor> │ poll {effective?.pollInterval ?? cfg.pollIntervalSeconds}s</Text>
                {cfg.maxIterationsPerTask > 0 && (
                  <Text color="yellow"> │ iter ≤{cfg.maxIterationsPerTask}</Text>
                )}
                {cfg.maxCostUsdPerTask > 0 && (
                  <Text color="yellow"> │ cost ≤${cfg.maxCostUsdPerTask}</Text>
                )}
                {args.maxTickets > 0 && <Text color="yellow"> │ tickets ≤{args.maxTickets}</Text>}
                {cfg.createPrOnSuccess && <Text color="green"> ● PR</Text>}
                {cfg.prRecovery.enabled && (
                  <Text color="green"> ● recover{cfg.prRecovery.fixCi ? "+CI" : ""}</Text>
                )}
                {cfg.useWorktree && <Text color="green"> ● worktree</Text>}
              </Text>
            )}
          </Text>
          {/* Line 1b: host CPU/memory/swap, sampled each poll. */}
          {sysMetrics && <SystemMetricsLine metrics={sysMetrics} />}
          {/* Line 2+: Linear filter — wrapped across as many lines as needed */}
          {pollStatus.filterDesc &&
            (() => {
              const prefix = "Linear  ";
              const indent = " ".repeat(prefix.length);
              const full = pollStatus.filterDesc.replace(/, /g, "  ·  ");
              const lineWidth = Math.max(20, termWidth - 4);
              const lines: string[] = [];
              let remaining = full;
              while (remaining.length > 0) {
                const budget = lineWidth - (lines.length === 0 ? prefix.length : indent.length);
                lines.push(remaining.slice(0, budget));
                remaining = remaining.slice(budget);
              }
              return lines.map((segment, i) => (
                <Text key={i} dimColor>
                  {i === 0 ? prefix : indent}
                  {segment}
                </Text>
              ));
            })()}
          {/* Line 3: authenticated Linear user — makes a wrong/expired key
              visible instead of silently matching zero tickets. */}
          {authedUser ? (
            <Text dimColor>{`Auth    ${authedUser.name} <${authedUser.email}>`}</Text>
          ) : (
            <Text color="yellow">
              {"Auth    LINEAR_API_KEY did not resolve a user — key may be invalid or expired"}
            </Text>
          )}
        </LabeledBox>

        {/* ── TASKS board — one lifecycle row per live ticket ─── */}
        {/* The liveness (poll state + next-poll countdown) lives on the box
            header border, left label + right liveness; counts are implicit in
            the rows below, so there is no count strip and no inner header. */}
        {!(cardFullScreen && focusedWorker) &&
          (() => {
            const tasksInnerWidth = Math.max(0, termWidth - 2);
            const lead = "─ ";
            const hint = " ↑↓·0-9·^F·^W ";
            const live = ` ${tasksLiveness} `;
            const trail = "─";
            // Fill the header border between the left label and the right liveness
            // so the node spans exactly the inner width (labelVisualWidth = inner
            // width ⇒ LabeledBox adds no outer dashes).
            const fixed = lead.length + "TASKS".length + hint.length + live.length + trail.length;
            const fill = Math.max(1, tasksInnerWidth - fixed);
            return (
              <LabeledBox
                labelVisualWidth={tasksInnerWidth}
                labelNode={
                  <Box flexDirection="row">
                    <Text color="gray">{lead}</Text>
                    <Text bold>TASKS</Text>
                    <Text dimColor>{hint}</Text>
                    <Text color="gray">{"─".repeat(fill)}</Text>
                    <Text dimColor>{live}</Text>
                    <Text color="gray">{trail}</Text>
                  </Box>
                }
                borderColor="gray"
                width={termWidth}
                paddingX={1}
                flexDirection="column"
              >
                {board.length === 0 ? (
                  <Text dimColor>no active tickets</Text>
                ) : (
                  (() => {
                    // The identifier column holds the dependency indent too, so a
                    // nested row's `└ ` prefix (depth*2 cols) never pushes the
                    // pipeline glyphs out of alignment.
                    const idColWidth = Math.max(
                      8,
                      ...tree.map((t) => t.depth * 2 + t.row.identifier.length),
                    );
                    const idxWidth = String(tree.length).length + 3;
                    const prefixWidth = 2 + idxWidth + idColWidth + 1;
                    // Stall detection: tickets exist but none can advance — no live
                    // worker, no automated step, and every remaining row is blocked,
                    // awaiting confirmation, or bailed. Surface why, so an idle board
                    // doesn't read as "done".
                    const advancing =
                      activeCount > 0 || tree.some((t) => ADVANCING_STATES.has(t.row.state));
                    const hasStartableTodo = tree.some(
                      (t) => t.row.state === "todo" && !(t.row.blockedByIds?.length ?? 0),
                    );
                    const stalled = !advancing && !hasStartableTodo;
                    const blockedCount = tree.filter(
                      (t) => t.row.state === "todo" && (t.row.blockedByIds?.length ?? 0) > 0,
                    ).length;
                    const awaitingCount = tree.filter((t) => t.row.state === "awaiting").length;
                    const quarantinedCount = tree.filter(
                      (t) => t.row.state === "quarantined",
                    ).length;
                    const stallParts = [
                      blockedCount > 0 ? `${blockedCount} blocked` : null,
                      awaitingCount > 0 ? `${awaitingCount} awaiting confirmation` : null,
                      quarantinedCount > 0 ? `${quarantinedCount} quarantined` : null,
                    ].filter((p): p is string => p !== null);
                    return (
                      <>
                        {/* Node labels, aligned over the row glyphs via a fixed prefix */}
                        <Box>
                          <Text>{" ".repeat(prefixWidth)}</Text>
                          <PipelineCells glyphs={null} />
                        </Box>
                        {visibleTree.map(({ row, depth }, i) => {
                          const isFocused = row.id === focusedRow?.id;
                          // `└ ` connector at depth>0, two spaces per level above.
                          const indent = depth > 0 ? "  ".repeat(depth - 1) + "└ " : "";
                          // Open blockers, named — includes blockers not on the
                          // board (which the indent can't express).
                          const blockers = row.blockedByIdentifiers ?? [];
                          const activeW = coordRef.current?.activeWorkers.find(
                            (w) => w.issueId === row.id,
                          );
                          const meta = activeW
                            ? workerMetaRef.current.get(activeW.changeName)
                            : undefined;
                          // A work-state row with no live worker is waiting for a
                          // worker slot — show a "waiting for worker" mark instead
                          // of a timer that is not yet counting anything.
                          const waitingForWorker = !activeW && WORKER_WAIT_STATES.has(row.state);
                          // AGE: live worker uptime when active; else time since the
                          // first recovery failure; else unknown.
                          let age = "–";
                          if (meta?.startedAt) {
                            age = fmtElapsed(now - meta.startedAt);
                          } else if (!waitingForWorker && row.recovery?.firstFailedAt) {
                            const failedAt = Date.parse(row.recovery.firstFailedAt);
                            if (!Number.isNaN(failedAt)) age = fmtElapsed(now - failedAt);
                          }
                          const prUrl = meta?.prUrl ?? row.prUrl ?? null;
                          return (
                            <Box key={row.id}>
                              <Box width={2}>
                                <Text color="white" bold>
                                  {isFocused ? "▶" : " "}
                                </Text>
                              </Box>
                              <Box width={idxWidth}>
                                <Text dimColor={!isFocused}>[{winStart + i}]</Text>
                              </Box>
                              <Box width={idColWidth + 1}>
                                {indent && <Text dimColor>{indent}</Text>}
                                <Link
                                  url={row.url}
                                  label={row.identifier}
                                  color={isFocused ? "cyan" : "gray"}
                                />
                              </Box>
                              <PipelineCells glyphs={pipelineStages(row).map((s) => s.status)} />
                              <Text color={isFocused ? "white" : "gray"} dimColor={!isFocused}>
                                {"  "}
                                {statusLabel(row)}
                              </Text>
                              {blockers.length > 0 && (
                                <Text color="yellow" dimColor={!isFocused}>
                                  {"  ⛓ "}
                                  {trunc(blockers.join(", "), 28)}
                                </Text>
                              )}
                              {waitingForWorker ? (
                                <Text color="yellow">{"  waiting for worker"}</Text>
                              ) : (
                                <Text dimColor>
                                  {"  "}
                                  {age}
                                </Text>
                              )}
                              {prUrl && (
                                <>
                                  <Text dimColor>{"  ↗"}</Text>
                                  <Link url={prUrl} label={prLabel(prUrl)} color="green" />
                                </>
                              )}
                            </Box>
                          );
                        })}
                        {hiddenIdentifiers.length > 0 && (
                          <Box>
                            <Text>{" ".repeat(2)}</Text>
                            <Text dimColor>{`+${hiddenIdentifiers.length} more  `}</Text>
                            <Text dimColor>{hiddenIdentifiers.join(" · ")}</Text>
                          </Box>
                        )}
                        {stalled && (
                          <Box marginTop={1}>
                            <Text color="yellow" bold>
                              {"⏸ nothing can start"}
                            </Text>
                            {stallParts.length > 0 && (
                              <Text color="yellow">{`  —  ${stallParts.join("  ·  ")}`}</Text>
                            )}
                          </Box>
                        )}
                      </>
                    );
                  })()
                )}
              </LabeledBox>
            );
          })()}

        {/* Gated (awaiting-confirmation) tickets are no longer a separate card —
            they render inline in the TASKS board above as `awaiting` rows. */}

        {/* ── Box 4: the focused ticket ─────────────────────────
            An active worker gets the full card (live CMD / OUTPUT / phase
            pipeline / subtasks / steering). A parked ticket gets a compact
            read-only card below (pipeline + state + recovery + AGE + PR).
            Hidden in full-screen so the board owns the whole terminal. */}
        {!boardFullScreen &&
          focusedWorker &&
          (() => {
            const w = focusedWorker;
            const meta = workerMetaRef.current.get(w.changeName);
            const elapsed = meta ? fmtElapsed(now - meta.startedAt) : "–";
            const iter = meta?.iter ?? 0;
            const phase = meta?.phase ?? "working";
            const phaseDetail = meta?.phaseDetail ?? "";
            const cmd = meta?.currentCmd;
            const cmdElapsed = cmd ? fmtElapsed(now - cmd.startedAt) : null;
            const tail = meta?.tail ?? [];
            const prUrl = meta?.prUrl ?? null;
            const currentTask = meta?.currentTask ?? null;
            const taskProgress = meta?.taskProgress ?? null;
            const openspecPhase = meta?.openspecPhase ?? null;
            const subtasks = meta?.subtasks ?? [];

            const mBadge = modeBadge(w.trigger);
            const pColor = phaseColor(phase);
            const bColor = workerBorderColor(phase);
            const visibleTailLines = focusedTailLines;

            /* Full card for the focused worker */
            const cardLabelWidth =
              (prUrl ? prLabel(prUrl).length + 3 : 0) + w.issueIdentifier.length + 2;
            const cardLabelNode = (
              <>
                <Text color={bColor}> </Text>
                {prUrl && <Link url={prUrl} label={prLabel(prUrl)} color="green" />}
                {prUrl && <Text color={bColor}> · </Text>}
                <Link url={w.issue.url} label={w.issueIdentifier} color="cyan" />
                <Text color={bColor}> </Text>
              </>
            );
            return (
              <LabeledBox
                key={w.changeName}
                labelNode={cardLabelNode}
                labelVisualWidth={cardLabelWidth}
                borderColor={bColor}
                flexDirection="column"
                paddingX={1}
                width={termWidth}
              >
                {/* ── Card header ─────────────────────────────── */}
                <Box gap={2}>
                  <Text>{spinnerFrame}</Text>
                  <Text color="white" bold>
                    {trunc(w.issue.title, Math.max(20, termWidth - 55))}
                  </Text>
                  <Text color={mBadge.color} bold>
                    [{mBadge.text}]
                  </Text>
                  <Text color={pColor} bold>
                    {phase}
                    {phaseDetail ? ` (${phaseDetail})` : ""}
                  </Text>
                  <Text dimColor>│</Text>
                  <Text color="white">{elapsed}</Text>
                  <Text dimColor>│</Text>
                  <Text dimColor>↺</Text>
                  <Text color="white" bold>
                    {iter}
                  </Text>
                </Box>

                {/* ── Current task ────────────────────────────── */}
                {currentTask && (
                  <Box gap={1} marginTop={0}>
                    <Text color="yellow" bold>
                      ▶ TASK
                    </Text>
                    {openspecPhase && (
                      <Text color={openspecPhaseColor(openspecPhase)} bold>
                        [phase: {openspecPhase}]
                      </Text>
                    )}
                    <Text color="white">
                      {trunc(
                        currentTask,
                        termWidth - 14 - (openspecPhase ? openspecPhase.length + 11 : 0),
                      )}
                    </Text>
                  </Box>
                )}

                {/* ── Command (when active) ────────────────────── */}
                {cmd && (
                  <Box gap={1} marginTop={0}>
                    <Text color="yellow">⏵ CMD</Text>
                    <Text color="yellow">{fmtCmd(cmd.argv)}</Text>
                    <Text dimColor>{cmdElapsed}</Text>
                  </Box>
                )}

                {/* ── Output tail ─────────────────────────────── */}
                {tail.length > 0 && !(showPendingTasks && showAllSubtasks) && (
                  <Box flexDirection="column" marginTop={0}>
                    <Text dimColor>
                      {"─ OUTPUT "}
                      {"─".repeat(Math.max(4, termWidth - 14))}
                    </Text>
                    {tail.slice(-visibleTailLines).map((line, i) => (
                      <Text key={`${w.changeName}-tail-${i}`} dimColor>
                        {"│ "}
                        {trunc(line, termWidth - 6)}
                      </Text>
                    ))}
                  </Box>
                )}

                {/* ── Phase pipeline (pre-implement phases) ───── */}
                {shouldShowPhasePipeline(openspecPhase) && (
                  <Box marginTop={0}>
                    {phasePipeline(openspecPhase as OpenSpecPhase).map((seg, i, arr) => {
                      const glyph =
                        seg.status === "done" ? "✓" : seg.status === "current" ? "●" : "○";
                      const node =
                        seg.status === "done" ? (
                          <Text color="green">
                            {glyph} {seg.label}
                          </Text>
                        ) : seg.status === "current" ? (
                          <Text color={openspecPhaseColor(seg.phase)} bold>
                            {glyph} {seg.label}
                          </Text>
                        ) : (
                          <Text dimColor>
                            {glyph} {seg.label}
                          </Text>
                        );
                      return (
                        <Box key={seg.phase}>
                          {node}
                          {i < arr.length - 1 && <Text dimColor> ─ </Text>}
                        </Box>
                      );
                    })}
                  </Box>
                )}

                {/* ── Subtasks panel (Ctrl+T) ─────────────────── */}
                {shouldShowSubtasksPanel(openspecPhase, showPendingTasks, subtasks.length > 0) && (
                  <Box flexDirection="column" marginTop={0}>
                    {(() => {
                      const header = `─ SUBTASKS (${subtasks.length}) CTRL+T to close `;
                      const pad = "─".repeat(Math.max(4, termWidth - header.length - 4));
                      return <Text dimColor>{`${header}${pad}`}</Text>;
                    })()}
                    {(showAllSubtasks
                      ? subtasks
                      : orderSubtasksForCappedDisplay(subtasks).slice(0, MAX_PENDING_DISPLAY)
                    ).map((s, i, arr) => {
                      const ord = `${i + 1}.`.padStart(`${arr.length}.`.length, " ");
                      const reserved = ord.length + 5; // "ord [x] "
                      return (
                        <Text key={`${w.changeName}-subtask-${i}`}>
                          {s.done ? (
                            <Text dimColor>{`${ord} [x] `}</Text>
                          ) : (
                            <Text>{`${ord} [ ] `}</Text>
                          )}
                          {s.done ? (
                            <Text dimColor>{trunc(s.text, termWidth - reserved)}</Text>
                          ) : (
                            <Text>{trunc(s.text, termWidth - reserved)}</Text>
                          )}
                        </Text>
                      );
                    })}
                    {!showAllSubtasks && subtasks.length > MAX_PENDING_DISPLAY && (
                      <Text dimColor>
                        {`    … +${subtasks.length - MAX_PENDING_DISPLAY} more (CTRL+L to expand)`}
                      </Text>
                    )}
                  </Box>
                )}

                {/* ── Steering input (Ctrl+S) ─────────────────── */}
                {steeringActive && (
                  <Box marginTop={0}>
                    <SteeringField
                      active={steeringActive}
                      width={termWidth - 2}
                      initialBuffer={steeringBufferRef.current}
                      initialCursor={steeringCursorRef.current}
                      initialFocused={steeringFocusedInitRef.current}
                      onFocusChange={(f) => {
                        steeringFocusedRef.current = f;
                        steeringFocusedInitRef.current = f;
                      }}
                      onStateChange={(s) => {
                        steeringBufferRef.current = s.buffer;
                        steeringCursorRef.current = s.cursor;
                      }}
                      onSubmit={async (message) => {
                        try {
                          await appendSteering(join(tasksDir, w.changeName), message);
                          fileEmit({
                            type: "steering_submitted",
                            changeName: w.changeName,
                            message,
                          });
                        } catch (err) {
                          const text = (err as Error).message;
                          fileEmit({
                            type: "error",
                            code: "steering_failure",
                            changeName: w.changeName,
                            text,
                          });
                          appendLog(`! steering append failed for ${w.changeName}: ${text}`, "red");
                          throw err;
                        }
                        // Fire the comment-sync hook (best-effort) before the
                        // worker restart so the steering comment lands on
                        // Linear even if the new iteration hasn't synced yet.
                        try {
                          await coordRef.current?.notifySteeringAppended?.(w.changeName, message);
                        } catch {
                          /* hook errors are already logged inside the coordinator */
                        }
                        const restarted = await coordRef.current?.restartWorker(w.changeName);
                        fileEmit({
                          type: "worker_restart",
                          changeName: w.changeName,
                          restarted: !!restarted,
                        });
                        if (restarted) {
                          appendLog(
                            `  ${w.changeName}: steering applied, restarting worker`,
                            "cyan",
                          );
                        } else {
                          appendLog(
                            `  ${w.changeName}: steering queued — will apply on next iteration`,
                            "gray",
                          );
                        }
                      }}
                    />
                  </Box>
                )}

                {/* ── Task progress bar (when panel collapsed) ── */}
                {shouldShowProgressBar(openspecPhase, showPendingTasks, taskProgress !== null) &&
                  taskProgress &&
                  (() => {
                    const hint = " CTRL+T to open";
                    const bar = calcProgressBar(
                      taskProgress.checked,
                      taskProgress.total,
                      termWidth - 4 - hint.length,
                    );
                    if (!bar) return null;
                    const { countStr, filledLeft, leftSlot, filledRight, rightSlot } = bar;
                    return (
                      <Box marginTop={0}>
                        <Text dimColor>[</Text>
                        <Text color="green">{"█".repeat(filledLeft)}</Text>
                        <Text dimColor>{"░".repeat(leftSlot - filledLeft)}</Text>
                        <Text color="white" bold>
                          {countStr}
                        </Text>
                        <Text color="green">{"█".repeat(filledRight)}</Text>
                        <Text dimColor>{"░".repeat(rightSlot - filledRight)}</Text>
                        <Text dimColor>]</Text>
                        <Text dimColor>{hint}</Text>
                      </Box>
                    );
                  })()}
              </LabeledBox>
            );
          })()}

        {/* Parked focused ticket — read-only card, no CMD / OUTPUT / steering.
            Hidden in full-screen so the board owns the whole terminal. */}
        {!boardFullScreen &&
          !focusedWorker &&
          focusedRow &&
          (() => {
            const row = focusedRow;
            let age = "–";
            if (row.recovery?.firstFailedAt) {
              const failedAt = Date.parse(row.recovery.firstFailedAt);
              if (!Number.isNaN(failedAt)) age = fmtElapsed(now - failedAt);
            }
            const prUrl = row.prUrl ?? null;
            const cardLabelWidth =
              (prUrl ? prLabel(prUrl).length + 3 : 0) + row.identifier.length + 2;
            const cardLabelNode = (
              <>
                <Text color="gray"> </Text>
                {prUrl && <Link url={prUrl} label={prLabel(prUrl)} color="green" />}
                {prUrl && <Text color="gray"> · </Text>}
                <Link url={row.url} label={row.identifier} color="cyan" />
                <Text color="gray"> </Text>
              </>
            );
            return (
              <LabeledBox
                key={row.id}
                labelNode={cardLabelNode}
                labelVisualWidth={cardLabelWidth}
                borderColor="gray"
                flexDirection="column"
                paddingX={1}
                width={termWidth}
              >
                <Text color="white" bold>
                  {trunc(row.title, Math.max(20, termWidth - 20))}
                </Text>
                <Box marginTop={0}>
                  <PipelineCells glyphs={pipelineStages(row).map((s) => s.status)} />
                  <Text color="white">
                    {"  "}
                    {statusLabel(row)}
                  </Text>
                </Box>
                <Box gap={2} marginTop={0}>
                  <Text dimColor>parked · no live worker</Text>
                  <Text dimColor>│</Text>
                  <Text dimColor>age {age}</Text>
                  {prUrl && (
                    <>
                      <Text dimColor>│</Text>
                      <Link url={prUrl} label={prLabel(prUrl)} color="green" />
                    </>
                  )}
                </Box>
              </LabeledBox>
            );
          })()}
      </Box>
      {awaitingClose && <Text color="cyan">Stopped — press Enter to close…</Text>}
    </Box>
  );
}
