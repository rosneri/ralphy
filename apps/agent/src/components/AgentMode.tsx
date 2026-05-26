import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, Transform, useApp, useInput, useStdin } from "ink";
import { join } from "node:path";
import { VERSION, type AgentParsedArgs } from "../cli";
import {
  ensureRalphyConfig as ensureRalphyConfigImpl,
  loadRalphyConfig as loadRalphyConfigImpl,
  type RalphyConfig,
} from "../agent/config";
import type { ActiveWorker, PauseState, PollResult } from "../agent/coordinator";
import { buildAgentCoordinator as buildAgentCoordinatorImpl } from "../agent/wire";
import { runPreflight as runPreflightImpl, type PreflightResult } from "@ralphy/engine/preflight";
import { createJsonLogFileSink } from "../agent/json-log/json-log-file";
import { waitForActiveWorkers } from "../runtime/shutdown";

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
import { isFlowTaskHeading } from "@ralphy/core/tasks-md";
import {
  deriveOpenSpecPhase,
  phasePipeline,
  shouldShowPhasePipeline,
  shouldShowProgressBar,
  shouldShowSubtasksPanel,
  type OpenSpecPhase,
} from "@ralphy/core/openspec-phase";
import { logSession, logCoord, logPhase } from "@ralphy/log";
import { useTerminalSize } from "@ralphy/ui-shared/useTerminalSize";
import { SteeringField } from "./SteeringField";
import { appendSteeringMessage } from "@ralphy/core/loop";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { cleanOutputLine } from "../shared/capabilities/output-utils";

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
  /** Test injection — defaults to the real `loadRalphyConfig`. */
  loadConfig?: typeof loadRalphyConfigImpl;
  /** Test injection — defaults to the real `runPreflight`. */
  runPreflight?: () => Promise<PreflightResult>;
}

interface LogLine {
  id: string;
  text: string;
  color?: string | undefined;
}

let lineCounter = 0;
function nextId(): string {
  lineCounter += 1;
  return `${Date.now()}-${lineCounter}`;
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

/**
 * Extract all `- [x]` / `- [ ]` items from a tasks.md document, in order.
 *
 * Skips items under:
 *  - `## Planning` — OpenSpec pipeline scaffolding, not mission work.
 *  - any section whose heading is a recognized flow-task heading
 *    (`Fix failing CI checks`, `Resolve PR merge conflicts`, …). This
 *    is the backward-compat path: new flow tasks land in
 *    `agent-tasks.md` (which this function never reads), but older
 *    in-flight `tasks.md` files may still contain inline flow sections.
 */
export function parseSubtasks(tasksMd: string): Array<{ done: boolean; text: string }> {
  const out: Array<{ done: boolean; text: string }> = [];
  let skipSection = false;
  for (const line of tasksMd.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1]!.trim();
      skipSection = title.toLowerCase() === "planning" || isFlowTaskHeading(title);
      continue;
    }
    if (skipSection) continue;
    const m = line.match(/^- \[([ xX])\] (.+)$/);
    if (m) out.push({ done: m[1] !== " ", text: m[2]!.trim() });
  }
  return out;
}

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

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${(m % 60).toString().padStart(2, "0")}m`;
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

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

/** Extract a short label from a GitHub PR URL, e.g. "#123". */
function prLabel(prUrl: string): string {
  const m = prUrl.match(/\/pull\/(\d+)/);
  return m ? `#${m[1]}` : "PR";
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

function priorityBadge(p: number): { text: string; color: string; label: string } {
  switch (p) {
    case 1:
      return { text: "▲", color: "red", label: "URGENT" };
    case 2:
      return { text: "↑", color: "yellow", label: "HIGH" };
    case 3:
      return { text: "·", color: "blue", label: "MED" };
    case 4:
      return { text: "↓", color: "gray", label: "LOW" };
    default:
      return { text: " ", color: "gray", label: "" };
  }
}

function modeBadge(mode: string): { text: string; color: string } {
  switch (mode) {
    case "fresh":
      return { text: "NEW", color: "cyan" };
    case "resume":
      return { text: "RES", color: "yellow" };
    case "conflict-fix":
      return { text: "FIX", color: "magenta" };
    default:
      return { text: mode.toUpperCase(), color: "white" };
  }
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

function displayTailLines(activeCount: number): number {
  if (activeCount <= 1) return 20;
  if (activeCount <= 2) return 12;
  if (activeCount <= 3) return 8;
  return 5;
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
  loadConfig = loadRalphyConfigImpl,
  runPreflight = runPreflightImpl,
}: AgentModeProps) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { columns, rows, resizeKey } = useTerminalSize();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [preflightError, setPreflightError] = useState<{ tool: string; message: string } | null>(
    null,
  );
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(0);
  /** Index into activeWorkers of the focused worker card (0-based). */
  const [focusedIdx, setFocusedIdx] = useState(0);
  /** Toggled by Ctrl+T — show the focused worker's pending tasks at the bottom of its card. */
  const [showPendingTasks, setShowPendingTasks] = useState(false);
  /** Toggled by Ctrl+L — expand subtasks over the OUTPUT feed (no cap). */
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  const coordRef = useRef<AgentModeCoordinator | null>(null);
  const workerMetaRef = useRef<Map<string, WorkerMeta>>(new Map());
  /** Tickets parked in `awaiting-confirmation`, populated by `onAwaitingTicket`
   *  during each pollOnce. Cleared at the start of every poll so the dashboard
   *  only renders the gated set the latest poll actually observed. */
  const gatedTicketsRef = useRef<
    Map<
      string,
      {
        issueIdentifier: string;
        issueUrl: string;
        issueTitle: string;
        since: string | null;
        round: number;
      }
    >
  >(new Map());
  const nextPollAtRef = useRef<number>(0);
  const cfgRef = useRef<RalphyConfig | null>(null);
  const [effective, setEffective] = useState<{ concurrency: number; pollInterval: number } | null>(
    null,
  );
  const [pollStatus, setPollStatus] = useState<{
    state: "idle" | "polling";
    lastFound: number | null;
    lastAdded: number | null;
    lastAt: number | null;
    filterDesc: string;
    lastBuckets: {
      todo: number;
      inProgress: number;
      conflicted: number;
      review: number;
      mentions: number;
      awaiting: number;
    } | null;
    lastPrStatus: {
      mergeable: number;
      conflicted: number;
      ciFailed: number;
    } | null;
  }>({
    state: "idle",
    lastFound: null,
    lastAdded: null,
    lastAt: null,
    filterDesc: "",
    lastBuckets: null,
    lastPrStatus: null,
  });

  function appendLog(text: string, color?: string, workerLogFile?: string) {
    setLogs((prev) => [...prev, { id: nextId(), text, color }]);
    logCoord(text, workerLogFile);
  }

  const fileSinkRef = useRef(createJsonLogFileSink(args.jsonLogFile));

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const fileSink = fileSinkRef.current;
    const fileEmit = (event: Record<string, unknown>): void => fileSink.emit(event);

    async function init() {
      logSession(`=== session start ${SESSION_START} ===`);
      const cfgPath = await ensureConfig(projectRoot);
      const cfg = await loadConfig(projectRoot);
      cfgRef.current = cfg;
      appendLog(`agent mode v${VERSION} — config: ${cfgPath}`, "gray");

      const apiKey = process.env["LINEAR_API_KEY"];
      if (!apiKey) {
        throw new Error("LINEAR_API_KEY not set — cannot poll Linear");
      }

      const pf = await runPreflight();
      if (!pf.ok) {
        fileEmit({ type: "error", code: "auth_failure", tool: pf.tool, text: pf.message });
        setPreflightError({ tool: pf.tool, message: pf.message });
        process.exitCode = 2;
        setTimeout(() => {
          exit();
          setTimeout(() => process.exit(2), 200);
        }, 100);
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
          fileEmit({ type: "worker_pr", changeName, prUrl });
          const m = workerMetaRef.current.get(changeName);
          if (m) m.prUrl = prUrl;
        },
        onAwaitingTicket: (info) => {
          fileEmit({
            type: "awaiting_confirmation",
            changeName: info.changeName,
            issueIdentifier: info.issueIdentifier,
            issueUrl: info.issueUrl,
            since: info.since,
            round: info.round,
          });
          gatedTicketsRef.current.set(info.changeName, {
            issueIdentifier: info.issueIdentifier,
            issueUrl: info.issueUrl,
            issueTitle: info.issueTitle,
            since: info.since,
            round: info.round,
          });
        },
      });
      setEffective({ concurrency, pollInterval });

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
          appendLog(`! baseline gate failed: ${(err as Error).message}`, "yellow");
        }
        if (cancelled) return;
        // Refreshed inside coord.pollOnce via the onAwaitingTicket callback —
        // clear first so tickets that have transitioned out of the gate stop
        // rendering on the next frame.
        gatedTicketsRef.current.clear();
        const { found, added, buckets, prStatus } = await coord.pollOnce();
        if (cancelled) return;
        fileEmit({ type: "poll_done", found, added, buckets, prStatus });
        if (added > 0) {
          appendLog(`  ${added} new issue${added === 1 ? "" : "s"} queued (found ${found} open)`);
        }
        setPollStatus({
          state: "idle",
          lastFound: found,
          lastAdded: added,
          lastAt: Date.now(),
          filterDesc,
          lastBuckets: buckets,
          lastPrStatus: prStatus,
        });
        nextPollAtRef.current = Date.now() + pollInterval * 1000;
        pollTimer = setTimeout(tick, pollInterval * 1000);
      };
      void tick();
    }

    void init().catch((err: unknown) => {
      appendLog(`! ${err instanceof Error ? err.message : String(err)}`, "red");
      // Delay exit so React can render the error in the logs panel before unmounting.
      setTimeout(() => {
        exit();
        setTimeout(() => process.exit(1), 200);
      }, 100);
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

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      void (async () => {
        for (const [changeName, meta] of workerMetaRef.current) {
          try {
            const file = Bun.file(join(meta.statesDir, changeName, ".ralph-state.json"));
            if (await file.exists()) {
              const json = (await file.json()) as { iteration?: number; reviewRounds?: number };
              meta.iter = json.iteration ?? meta.iter;
              meta.reviewRounds = json.reviewRounds ?? meta.reviewRounds;
            }
          } catch (err) {
            console.error(
              `Failed to read state file for worker '${changeName}' (may not exist yet):`,
              err,
            );
          }
          if (meta.changeDir) {
            try {
              const tasksFile = Bun.file(join(meta.changeDir, "tasks.md"));
              const proposalFile = Bun.file(join(meta.changeDir, "proposal.md"));
              const designFile = Bun.file(join(meta.changeDir, "design.md"));
              const reviewFindingsFile = Bun.file(join(meta.changeDir, "review-findings.md"));
              const [tasksText, proposalText, designText, reviewFindingsText] = await Promise.all([
                tasksFile.exists().then((ok) => (ok ? tasksFile.text() : null)),
                proposalFile.exists().then((ok) => (ok ? proposalFile.text() : null)),
                designFile.exists().then((ok) => (ok ? designFile.text() : null)),
                reviewFindingsFile.exists().then((ok) => (ok ? reviewFindingsFile.text() : null)),
              ]);
              if (tasksText !== null) {
                const subtasks = parseSubtasks(tasksText);
                meta.subtasks = subtasks;
                meta.currentTask = subtasks.find((s) => !s.done)?.text ?? null;
                const total = subtasks.length;
                const checked = subtasks.filter((s) => s.done).length;
                meta.taskProgress = total > 0 ? { checked, total } : null;
              }
              const reviewRounds = meta.reviewRounds;
              meta.openspecPhase = deriveOpenSpecPhase({
                proposal: proposalText,
                design: designText,
                tasks: tasksText,
                reviewFindings: reviewFindingsText,
                reviewRounds,
                maxReviewRounds: reviewFindingsText !== null || reviewRounds > 0 ? 999 : 0,
              });
            } catch (err) {
              console.error(
                `Failed to read change artifacts for worker '${changeName}' (may not exist yet):`,
                err,
              );
            }
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
  const activeCount = coord?.activeCount ?? 0;
  const termWidth = columns - 2;
  const termHeight = rows;

  // Keyboard navigation — cycle through workers with Tab / arrow keys.
  // When the steering field is focused, all worker-navigation shortcuts are
  // suppressed so digits/Tab/arrows/Ctrl+T flow into the text buffer instead.
  const safeFocusedIdx = activeCount > 0 ? Math.min(focusedIdx, activeCount - 1) : 0;
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
      if (activeCount === 0) return;
      if (key.tab || key.rightArrow) {
        setFocusedIdx((i) => (Math.min(i, activeCount - 1) + 1) % activeCount);
      } else if (key.leftArrow) {
        setFocusedIdx((i) => (Math.min(i, activeCount - 1) - 1 + activeCount) % activeCount);
      } else {
        const n = parseInt(input, 10);
        if (!isNaN(n) && n >= 1 && n <= activeCount) setFocusedIdx(n - 1);
      }
    },
    { isActive: isRawModeSupported && activeCount > 0 },
  );

  const focusedWorker = coordRef.current?.activeWorkers[safeFocusedIdx];
  const steeringActive = isRawModeSupported && activeCount > 0 && focusedWorker !== undefined;

  // Compute tail lines for the focused worker to fill available height.
  // Logs flow into terminal scrollback via <Static> so they don't occupy live
  // UI region. header-box(5) + poll-row(7) + tasks-box(5 when active)
  //   + card-non-tail(8) + compact-cards(4 each)
  const nonFocusedCount = Math.max(0, activeCount - 1);
  const tasksBoxLines = activeCount > 1 ? 5 : 0;
  // +3 rows for the steering field (top border + body row + bottom border)
  // when it is rendered inside the focused card.
  const steeringBoxLines = steeringActive ? 3 : 0;
  const FIXED_OVERHEAD = 5 + 7 + tasksBoxLines + 8 + steeringBoxLines + nonFocusedCount * 4;
  const focusedTailLines = Math.max(3, termHeight - FIXED_OVERHEAD);
  const compactTailLines = displayTailLines(activeCount);

  if (preflightError) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>
          ✖ Preflight failed — {preflightError.tool}
        </Text>
        <Text color="red">{preflightError.message}</Text>
      </Box>
    );
  }

  return (
    <Box key={resizeKey} flexDirection="column">
      {/* ── Scrolling log history ──────────────────────────────
          Rendered via <Static> so each line is permanently flushed
          to stdout above the live UI. The terminal's native
          scrollback owns history — no in-app cap or truncation. */}
      <Static items={logs}>
        {(line) =>
          line.color ? (
            <Text key={line.id} color={line.color}>
              {line.text}
            </Text>
          ) : (
            <Text key={line.id}>{line.text}</Text>
          )
        }
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
                {cfg.fixCiOnFailure && <Text color="green"> ● fixCI</Text>}
                {cfg.useWorktree && <Text color="green"> ● worktree</Text>}
              </Text>
            )}
          </Text>
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
        </LabeledBox>

        {/* ── Poll status + queue ─────────────────────────────── */}
        <Box flexDirection="row" gap={1} marginTop={0} width={termWidth}>
          {/* Poll status — two lines: issue buckets, then PR statuses */}
          <LabeledBox
            label="POLL STATUS"
            borderColor="gray"
            width={termWidth - 17}
            paddingX={1}
            flexDirection="column"
          >
            <Box gap={2}>
              <Text color="gray">{spinnerFrame}</Text>
              <Text>
                {pollStatus.state === "polling"
                  ? "Polling Linear…"
                  : pollStatus.lastAt !== null
                    ? "Idle"
                    : "Starting…"}
              </Text>
              {pollStatus.lastAt !== null && (
                <>
                  {pollStatus.lastBuckets && (
                    <>
                      <Text dimColor>│</Text>
                      <Text dimColor>todo</Text>
                      <Text color="white">{pollStatus.lastBuckets.todo}</Text>
                      <Text dimColor>·</Text>
                      <Text dimColor>resume</Text>
                      <Text color={pollStatus.lastBuckets.inProgress > 0 ? "cyan" : "white"}>
                        {pollStatus.lastBuckets.inProgress}
                      </Text>
                      <Text dimColor>·</Text>
                      <Text dimColor>review</Text>
                      <Text color={pollStatus.lastBuckets.review > 0 ? "yellow" : "white"}>
                        {pollStatus.lastBuckets.review}
                      </Text>
                      <Text dimColor>·</Text>
                      <Text dimColor>mentions</Text>
                      <Text color={pollStatus.lastBuckets.mentions > 0 ? "magenta" : "white"}>
                        {pollStatus.lastBuckets.mentions}
                      </Text>
                      <Text dimColor>·</Text>
                      <Text dimColor>awaiting</Text>
                      <Text color={pollStatus.lastBuckets.awaiting > 0 ? "yellow" : "white"}>
                        {pollStatus.lastBuckets.awaiting}
                      </Text>
                    </>
                  )}
                </>
              )}
            </Box>
            {pollStatus.lastAt !== null && pollStatus.lastPrStatus && (
              <Box gap={2}>
                {secsToNextPoll !== null ? (
                  <Box gap={1} width={7}>
                    <Text dimColor>↺</Text>
                    <Text color="gray">{secsToNextPoll}s</Text>
                  </Box>
                ) : (
                  <Text>{" ".repeat(7)}</Text>
                )}
                <Text dimColor>│</Text>
                <Text dimColor>mergeable</Text>
                <Text color={pollStatus.lastPrStatus.mergeable > 0 ? "green" : "white"}>
                  {pollStatus.lastPrStatus.mergeable}
                </Text>
                <Text dimColor>·</Text>
                <Text dimColor>conflicted</Text>
                <Text color={pollStatus.lastPrStatus.conflicted > 0 ? "red" : "white"}>
                  {pollStatus.lastPrStatus.conflicted}
                </Text>
                <Text dimColor>·</Text>
                <Text dimColor>ci-failed</Text>
                <Text color={pollStatus.lastPrStatus.ciFailed > 0 ? "red" : "white"}>
                  {pollStatus.lastPrStatus.ciFailed}
                </Text>
              </Box>
            )}
          </LabeledBox>

          {/* Worker queue summary — active and queued on their own lines */}
          <LabeledBox
            label="WORKERS"
            borderColor="gray"
            width={16}
            paddingX={1}
            flexDirection="column"
          >
            <Box gap={1}>
              <Text dimColor>active</Text>
              <Text color={activeCount > 0 ? "cyan" : "gray"} bold>
                {activeCount}
              </Text>
            </Box>
            <Box gap={1}>
              <Text dimColor>queue</Text>
              <Text color={(coord?.queuedCount ?? 0) > 0 ? "yellow" : "gray"} bold>
                {coord?.queuedCount ?? 0}
              </Text>
            </Box>
          </LabeledBox>
        </Box>

        {/* ── Worker tabs bar ─────────────────────────────────── */}
        {activeCount > 1 && (
          <LabeledBox
            label={`TASKS${activeCount > 1 ? "  Tab/← → · 1-9" : ""}`}
            borderColor="gray"
            width={termWidth}
            paddingX={1}
            flexDirection="column"
          >
            <Box gap={3} flexWrap="wrap">
              {coord?.activeWorkers.map((w, idx) => {
                const meta = workerMetaRef.current.get(w.changeName);
                const phase = meta?.phase ?? "working";
                const pBadge = priorityBadge(w.issue.priority);
                const isFocused = idx === safeFocusedIdx;
                return (
                  <Box key={w.changeName} gap={1}>
                    <Text color={isFocused ? "white" : "gray"} bold={isFocused}>
                      [{idx + 1}]
                    </Text>
                    {pBadge.label && (
                      <Text color={pBadge.color}>
                        {pBadge.text} {pBadge.label}
                      </Text>
                    )}
                    <Link
                      url={w.issue.url}
                      label={w.issueIdentifier}
                      color={isFocused ? "cyan" : "gray"}
                    />
                    <Text color={phaseColor(phase)} dimColor={!isFocused}>
                      {phase}
                    </Text>
                    {isFocused && <Text color="white">◀</Text>}
                  </Box>
                );
              })}
            </Box>
          </LabeledBox>
        )}

        {/* ── Gated (awaiting-confirmation) cards ─────────────── */}
        {Array.from(gatedTicketsRef.current.entries()).map(([changeName, g]) => {
          const askedAgo = g.since ? fmtElapsed(now - Date.parse(g.since)) : "just now";
          const cardLabelWidth = g.issueIdentifier.length + 2;
          const cardLabelNode = (
            <>
              <Text color="yellow"> </Text>
              <Link url={g.issueUrl} label={g.issueIdentifier} color="yellow" />
              <Text color="yellow"> </Text>
            </>
          );
          return (
            <LabeledBox
              key={`gated-${changeName}`}
              labelNode={cardLabelNode}
              labelVisualWidth={cardLabelWidth}
              borderColor="yellow"
              paddingX={1}
              gap={2}
              width={termWidth}
            >
              <Text color="yellow" bold>
                [GATE]
              </Text>
              <Text color="yellow">Awaiting confirmation</Text>
              <Text dimColor>·</Text>
              <Text dimColor>round</Text>
              <Text color="white" bold>
                {g.round}
              </Text>
              <Text dimColor>·</Text>
              <Text dimColor>asked</Text>
              <Text color="white">{askedAgo}</Text>
              <Text dimColor>ago</Text>
              <Text dimColor>│</Text>
              <Text dimColor>{trunc(g.issueTitle, Math.max(20, termWidth - 70))}</Text>
            </LabeledBox>
          );
        })}

        {/* ── Active worker cards ─────────────────────────────── */}
        {coord?.activeWorkers.map((w, idx) => {
          const isFocused = idx === safeFocusedIdx;
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

          const pBadge = priorityBadge(w.issue.priority);
          const mBadge = modeBadge(w.trigger);
          const pColor = phaseColor(phase);
          const bColor = isFocused ? workerBorderColor(phase) : "gray";
          const visibleTailLines = isFocused ? focusedTailLines : compactTailLines;

          /* Compact row for non-focused workers */
          if (!isFocused && activeCount > 1) {
            const cardLabelWidth =
              (prUrl ? prLabel(prUrl).length + 3 : 0) + w.issueIdentifier.length + 2;
            const cardLabelNode = (
              <>
                <Text color="gray"> </Text>
                {prUrl && <Link url={prUrl} label={prLabel(prUrl)} color="green" />}
                {prUrl && <Text color="gray"> · </Text>}
                <Link url={w.issue.url} label={w.issueIdentifier} color="cyan" />
                <Text color="gray"> </Text>
              </>
            );
            return (
              <LabeledBox
                key={w.changeName}
                labelNode={cardLabelNode}
                labelVisualWidth={cardLabelWidth}
                borderColor="gray"
                paddingX={1}
                gap={2}
                width={termWidth}
              >
                <Text dimColor>[{idx + 1}]</Text>
                {pBadge.label && <Text color={pBadge.color}>{pBadge.text}</Text>}
                <Text color="gray" bold>
                  {w.issueIdentifier}
                </Text>
                <Text dimColor>{trunc(w.issue.title, 40)}</Text>
                <Text dimColor>│</Text>
                <Text color={pColor} dimColor>
                  {phase}
                </Text>
                <Text dimColor>│</Text>
                <Text dimColor>{elapsed}</Text>
                <Text dimColor>·</Text>
                <Text dimColor>iter {iter}</Text>
                {currentTask && (
                  <>
                    <Text dimColor>│</Text>
                    {openspecPhase && (
                      <Text color={openspecPhaseColor(openspecPhase)}>[{openspecPhase}]</Text>
                    )}
                    <Text dimColor>▶ {trunc(currentTask, 40)}</Text>
                  </>
                )}
              </LabeledBox>
            );
          }

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
              {steeringActive && idx === safeFocusedIdx && (
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
                      } catch (err) {
                        appendLog(
                          `! steering append failed for ${w.changeName}: ${(err as Error).message}`,
                          "red",
                        );
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
                      if (restarted) {
                        appendLog(`  ${w.changeName}: steering applied, restarting worker`, "cyan");
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
        })}
      </Box>
    </Box>
  );
}
