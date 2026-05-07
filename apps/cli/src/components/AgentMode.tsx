import { useEffect, useRef, useState } from "react";
import { Box, Text, Transform, useApp, useInput, useStdin, useStdout } from "ink";
import { join, relative, dirname } from "node:path";
import { homedir } from "node:os";
import { appendFile, mkdir } from "node:fs/promises";
import { VERSION, type ParsedArgs } from "../cli";
import { ensureRalphyConfig, loadRalphyConfig, type RalphyConfig } from "../agent/config";
import { AgentCoordinator } from "../agent/coordinator";
import { buildAgentCoordinator } from "../agent/wire";

interface AgentModeProps {
  args: ParsedArgs;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
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
  prUrl: string | null;
  currentCmd: { argv: string[]; startedAt: number } | null;
  tail: string[];
}

const TAIL_BUFFER_SIZE = 30;
const CMD_DISPLAY_MAX = 80;

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
        <Text color={borderColor}>{`╭${"─".repeat(left)} ${label ?? ""} ${"─".repeat(right)}╮`}</Text>
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

// Strip ANSI escape codes (CSI, OSC, and 2-char sequences).
const ANSI_STRIP_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;
// Lines that are only box-drawing chars + spaces: Ink render artifacts.
const BOX_ONLY_RE = /^[\s─│╭╮╰╯╌┄━┃]+$/;
// Status bar tick line: braille-spinner "iter N │ $X │ Ns │ model" from TaskLoop's StatusBar.
const STATUS_BAR_LINE_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗]\s+iter\s+\d+/;
// Iteration header from IterationHeader component (starts with ──).
const ITER_HEADER_LINE_RE = /^──/;

/** Strip ANSI codes; return null if the line is a subprocess UI rendering artifact. */
function cleanOutputLine(raw: string): string | null {
  const clean = raw.replace(ANSI_STRIP_RE, "").trim();
  if (!clean) return null;
  if (BOX_ONLY_RE.test(clean)) return null;
  if (STATUS_BAR_LINE_RE.test(clean)) return null;
  if (ITER_HEADER_LINE_RE.test(clean)) return null;
  return clean;
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
    case "committing":
    case "commit-retry":
    case "pushing":
    case "push-retry":
    case "rebasing":
    case "pr-create":
      return "yellow";
    case "ci-poll":
    case "ci-fix":
      return "blue";
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

function workerBorderColor(phase: string): string {
  switch (phase) {
    case "working":
    case "scaffolding":
      return "cyan";
    case "committing":
    case "commit-retry":
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

/** Agent-mode debug log written to ~/.ralph/agent-mode.log (appended each session). */
const AGENT_LOG_PATH = join(homedir(), ".ralph", "agent-mode.log");
const SESSION_START = new Date().toISOString();
mkdir(dirname(AGENT_LOG_PATH), { recursive: true }).catch(() => undefined);

function writeAgentLog(text: string) {
  const clean = text.replace(ANSI_STRIP_RE, "").trim();
  if (!clean) return;
  const line = `[${new Date().toISOString()}] ${clean}\n`;
  appendFile(AGENT_LOG_PATH, line).catch(() => undefined);
}

export function AgentMode({ args, projectRoot, statesDir, tasksDir }: AgentModeProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(0);
  /** Index into activeWorkers of the focused worker card (0-based). */
  const [focusedIdx, setFocusedIdx] = useState(0);
  const coordRef = useRef<AgentCoordinator | null>(null);
  const workerMetaRef = useRef<Map<string, WorkerMeta>>(new Map());
  const nextPollAtRef = useRef<number>(0);
  const cfgRef = useRef<RalphyConfig | null>(null);
  const [pollStatus, setPollStatus] = useState<{
    state: "idle" | "polling";
    lastFound: number | null;
    lastAdded: number | null;
    lastAt: number | null;
    filterDesc: string;
  }>({ state: "idle", lastFound: null, lastAdded: null, lastAt: null, filterDesc: "" });

  function appendLog(text: string, color?: string) {
    setLogs((prev) => [...prev, { id: nextId(), text, color }]);
    writeAgentLog(text);
  }

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function init() {
      writeAgentLog(`=== session start ${SESSION_START} ===`);
      const cfgPath = await ensureRalphyConfig(projectRoot);
      const cfg = await loadRalphyConfig(projectRoot);
      cfgRef.current = cfg;
      appendLog(`agent mode v${VERSION} — config: ${cfgPath}`, "gray");

      const apiKey = process.env["LINEAR_API_KEY"];
      if (!apiKey) {
        appendLog("! LINEAR_API_KEY not set — cannot poll Linear", "red");
        exit();
        return;
      }

      const { coord, filterDesc, concurrency, pollInterval } = buildAgentCoordinator({
        args,
        cfg,
        projectRoot,
        statesDir,
        tasksDir,
        apiKey,
        onLog: appendLog,
        onWorkersChanged: () => setTick((t) => t + 1),
        onWorkerStarted: (changeName, dir, logFile, changeDir) => {
          writeAgentLog(`worker-started ${changeName} log=${logFile}`);
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
            prUrl: null,
            currentCmd: null,
            tail: [],
          });
        },
        onWorkerExited: (changeName) => {
          writeAgentLog(`worker-exited ${changeName}`);
          workerMetaRef.current.delete(changeName);
        },
        onWorkerPhase: (changeName, phase, detail) => {
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (m.phase !== phase) {
            writeAgentLog(`phase ${changeName}: ${phase}${detail ? ` (${detail})` : ""}`);
            m.phaseStartedAt = Date.now();
          }
          m.phase = phase;
          m.phaseDetail = detail ?? "";
        },
        onWorkerOutput: (changeName, line) => {
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          const clean = cleanOutputLine(line);
          if (!clean) return;
          m.tail.push(clean);
          if (m.tail.length > TAIL_BUFFER_SIZE) m.tail.splice(0, m.tail.length - TAIL_BUFFER_SIZE);
        },
        onWorkerCmd: (changeName, cmd, state) => {
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (state === "start") {
            m.currentCmd = { argv: cmd, startedAt: Date.now() };
          } else {
            m.currentCmd = null;
          }
        },
        onWorkerPr: (changeName, prUrl) => {
          const m = workerMetaRef.current.get(changeName);
          if (m) m.prUrl = prUrl;
        },
      });
      void concurrency;
      void pollInterval;

      coordRef.current = coord;
      await coord.init();

      const tick = async () => {
        if (cancelled) return;
        setPollStatus((p) => ({ ...p, state: "polling", filterDesc }));
        const { found, added } = await coord.pollOnce();
        if (cancelled) return;
        if (added > 0) {
          appendLog(`  ${added} new issue${added === 1 ? "" : "s"} queued (found ${found} open)`);
        }
        setPollStatus({
          state: "idle",
          lastFound: found,
          lastAdded: added,
          lastAt: Date.now(),
          filterDesc,
        });
        nextPollAtRef.current = Date.now() + pollInterval * 1000;
        pollTimer = setTimeout(tick, pollInterval * 1000);
      };
      void tick();
    }

    void init();

    const onSig = () => {
      cancelled = true;
      appendLog("stopping agent — sending SIGTERM to workers", "yellow");
      coordRef.current?.stop();
      if (pollTimer) clearTimeout(pollTimer);
      exit();
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
              const json = (await file.json()) as { iteration?: number };
              meta.iter = json.iteration ?? meta.iter;
            }
          } catch {
            /* state file may not exist yet */
          }
          if (meta.changeDir) {
            try {
              const tasksFile = Bun.file(join(meta.changeDir, "tasks.md"));
              if (await tasksFile.exists()) {
                const text = await tasksFile.text();
                const match = text.match(/^- \[ \] (.+)$/m);
                meta.currentTask = match?.[1]?.trim() ?? null;
              }
            } catch {
              /* tasks.md may not exist yet */
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
  const termWidth = (stdout?.columns ?? 100) - 2;
  const termHeight = stdout?.rows ?? 40;

  // Keyboard navigation — cycle through workers with Tab / arrow keys.
  const safeFocusedIdx = activeCount > 0 ? Math.min(focusedIdx, activeCount - 1) : 0;
  useInput(
    (input, key) => {
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
    { isActive: isRawModeSupported && activeCount > 1 },
  );

  // Compute tail lines for the focused worker to fill available height.
  // header-box(5) + poll-row(5) + tasks-box(5 when active) + card-non-tail(8) + compact-cards(4 each)
  const nonFocusedCount = Math.max(0, activeCount - 1);
  const tasksBoxLines = activeCount > 0 ? 5 : 0;
  const FIXED_OVERHEAD = 5 + 5 + tasksBoxLines + 8 + nonFocusedCount * 4;
  const focusedTailLines = Math.max(3, termHeight - FIXED_OVERHEAD);
  const compactTailLines = displayTailLines(activeCount);

  return (
    <Box flexDirection="column">
      {/* ── Scrolling log history ────────────────────────────── */}
      {logs.length > 0 && (
        <Box
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          width={termWidth}
        >
          {logs.slice(-5).map((line) =>
            line.color ? (
              <Text key={line.id} color={line.color}>
                {line.text}
              </Text>
            ) : (
              <Text key={line.id}>{line.text}</Text>
            ),
          )}
        </Box>
      )}

      <Box flexDirection="column" marginTop={0}>
        {/* ── Settings header — two compact text lines ─────────── */}
        <LabeledBox label="◈ RALPH AGENT" borderColor="blue" width={termWidth} paddingX={1} flexDirection="column">
          {/* Line 1: key settings */}
          <Text>
            <Text dimColor>v{VERSION}</Text>
            {cfg && (
              <Text>
                <Text dimColor> │ </Text>
                <Text color="cyan" bold>
                  {cfg.engine}/{cfg.model}
                </Text>
                <Text dimColor> │ ×{cfg.concurrency}</Text>
                <Text dimColor> │ poll {cfg.pollIntervalSeconds}s</Text>
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
        </Box>

        {/* ── Poll status + queue ─────────────────────────────── */}
        <Box flexDirection="row" gap={1} marginTop={0} width={termWidth}>
          {/* Poll status */}
          <LabeledBox label="POLL STATUS" borderColor="gray" width={termWidth - 30} paddingX={1} flexDirection="column">
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
                  <Text dimColor>│</Text>
                  <Text dimColor>found</Text>
                  <Text color="white">{pollStatus.lastFound}</Text>
                  <Text dimColor>│</Text>
                  <Text dimColor>new</Text>
                  <Text color={pollStatus.lastAdded! > 0 ? "green" : "white"}>
                    {pollStatus.lastAdded}
                  </Text>
                  {secsToNextPoll !== null && (
                    <>
                      <Text dimColor>│</Text>
                      <Text dimColor>next in</Text>
                      <Text color="gray">{secsToNextPoll}s</Text>
                    </>
                  )}
                </>
              )}
            </Box>
          </LabeledBox>

          {/* Worker queue summary */}
          <LabeledBox label="WORKERS" borderColor="gray" width={29} paddingX={1} flexDirection="column">
            <Box gap={3}>
              <Box gap={1}>
                <Text dimColor>active</Text>
                <Text color={activeCount > 0 ? "cyan" : "gray"} bold>
                  {activeCount}
                </Text>
              </Box>
              <Box gap={1}>
                <Text dimColor>queued</Text>
                <Text color={(coord?.queuedCount ?? 0 > 0) ? "yellow" : "gray"} bold>
                  {coord?.queuedCount ?? 0}
                </Text>
              </Box>
            </Box>
          </LabeledBox>
        </Box>

        {/* ── Worker tabs bar ─────────────────────────────────── */}
        {activeCount > 0 && (
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
                    <Link url={w.issue.url} label={w.issueIdentifier} color={isFocused ? "cyan" : "gray"} />
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

        {/* ── Active worker cards ─────────────────────────────── */}
        {coord?.activeWorkers.map((w, idx) => {
          const isFocused = idx === safeFocusedIdx;
          const meta = workerMetaRef.current.get(w.changeName);
          const elapsed = meta ? fmtElapsed(now - meta.startedAt) : "–";
          const iter = meta?.iter ?? 0;
          const phase = meta?.phase ?? "working";
          const phaseElapsed = meta ? fmtElapsed(now - meta.phaseStartedAt) : "–";
          const phaseDetail = meta?.phaseDetail ?? "";
          const cmd = meta?.currentCmd;
          const cmdElapsed = cmd ? fmtElapsed(now - cmd.startedAt) : null;
          const tail = meta?.tail ?? [];
          const prUrl = meta?.prUrl ?? null;
          const currentTask = meta?.currentTask ?? null;

          const pBadge = priorityBadge(w.issue.priority);
          const mBadge = modeBadge(w.mode);
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
                <Text dimColor>│</Text>
                {meta?.logFile && (
                  <Link url={`file://${meta.logFile}`} label="LOG" color="gray" />
                )}
              </Box>

              {/* ── Current task ────────────────────────────── */}
              {currentTask && (
                <Box gap={1} marginTop={0}>
                  <Text color="yellow" bold>
                    ▶ TASK
                  </Text>
                  <Text color="white">{trunc(currentTask, termWidth - 14)}</Text>
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
              {tail.length > 0 && (
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
            </LabeledBox>
          );
        })}
      </Box>
    </Box>
  );
}
