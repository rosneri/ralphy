import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import { join } from "node:path";
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
  /** First unchecked task from tasks.md — updated on each clock tick. */
  currentTask: string | null;
  /** PR URL registered via registerPr (post-task pipeline). */
  prUrl: string | null;
  /** In-flight shell command (post-task tracer). null when nothing is running. */
  currentCmd: { argv: string[]; startedAt: number } | null;
  /** Ring buffer of last N lines of worker stdout/stderr. */
  tail: string[];
}

/** How many lines to store per worker (ring buffer ceiling). */
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

/** Truncate a string and add ellipsis if needed. */
function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Priority label and color for a Linear priority level. */
function priorityBadge(p: number): { text: string; color: string } {
  switch (p) {
    case 1:
      return { text: "!", color: "red" };
    case 2:
      return { text: "↑", color: "yellow" };
    case 3:
      return { text: "·", color: "blue" };
    case 4:
      return { text: "↓", color: "gray" };
    default:
      return { text: " ", color: "gray" };
  }
}

/** Mode badge text and color for a spawn mode. */
function modeBadge(mode: string): { text: string; color: string } {
  switch (mode) {
    case "fresh":
      return { text: "new", color: "cyan" };
    case "resume":
      return { text: "resume", color: "yellow" };
    case "conflict-fix":
      return { text: "fix", color: "magenta" };
    default:
      return { text: mode, color: "white" };
  }
}

/** Text color for a worker phase. */
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

/** How many tail lines to display based on active worker count. */
function displayTailLines(activeCount: number): number {
  if (activeCount <= 1) return 20;
  if (activeCount <= 2) return 12;
  if (activeCount <= 3) return 8;
  return 6;
}

/** Compact settings summary for the sticky footer. */
function settingsSummary(cfg: RalphyConfig, filterDesc: string): string {
  const parts: string[] = [
    `${cfg.engine}/${cfg.model}`,
    `concurrency: ${cfg.concurrency}`,
    `poll: ${cfg.pollIntervalSeconds}s`,
  ];
  if (cfg.maxIterationsPerTask > 0) parts.push(`maxIter: ${cfg.maxIterationsPerTask}`);
  if (cfg.maxCostUsdPerTask > 0) parts.push(`maxCost: $${cfg.maxCostUsdPerTask}`);
  if (cfg.maxRuntimeMinutesPerTask > 0) parts.push(`maxRuntime: ${cfg.maxRuntimeMinutesPerTask}m`);
  if (cfg.createPrOnSuccess) parts.push("PR: on");
  if (cfg.fixCiOnFailure) parts.push("fixCI: on");
  if (cfg.useWorktree) parts.push("worktree: on");
  const settingsStr = parts.join(" · ");
  return filterDesc ? `${settingsStr}  [${filterDesc}]` : settingsStr;
}

export function AgentMode({ args, projectRoot, statesDir, tasksDir }: AgentModeProps) {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(0);
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
  }

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function init() {
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
          workerMetaRef.current.delete(changeName);
        },
        onWorkerPhase: (changeName, phase, detail) => {
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (m.phase !== phase) m.phaseStartedAt = Date.now();
          m.phase = phase;
          m.phaseDetail = detail ?? "";
        },
        onWorkerOutput: (changeName, line) => {
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          m.tail.push(line);
          if (m.tail.length > TAIL_BUFFER_SIZE) m.tail.splice(0, m.tail.length - TAIL_BUFFER_SIZE);
        },
        onWorkerCmd: (changeName, cmd, state, durationMs, ok) => {
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (state === "start") {
            m.currentCmd = { argv: cmd, startedAt: Date.now() };
          } else {
            m.currentCmd = null;
            void durationMs;
            void ok;
          }
        },
        onWorkerPr: (changeName, prUrl) => {
          const m = workerMetaRef.current.get(changeName);
          if (m) m.prUrl = prUrl;
        },
      });
      appendLog(
        `  concurrency: ${concurrency} · poll: ${pollInterval}s · ${cfg.engine}/${cfg.model}`,
        "gray",
      );
      const feats: string[] = [];
      if (cfg.createPrOnSuccess) feats.push("createPR");
      if (cfg.fixCiOnFailure) feats.push("fixCI");
      if (cfg.useWorktree) feats.push("worktree");
      if (cfg.maxIterationsPerTask > 0) feats.push(`maxIter=${cfg.maxIterationsPerTask}`);
      if (cfg.maxCostUsdPerTask > 0) feats.push(`maxCost=$${cfg.maxCostUsdPerTask}`);
      if (feats.length) appendLog(`  features: ${feats.join(", ")}`, "gray");

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

  // 1-second clock: update iter count + current task from disk.
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      void (async () => {
        for (const [changeName, meta] of workerMetaRef.current) {
          // Read iteration count from state file.
          try {
            const file = Bun.file(join(meta.statesDir, changeName, ".ralph-state.json"));
            if (await file.exists()) {
              const json = (await file.json()) as { iteration?: number };
              meta.iter = json.iteration ?? meta.iter;
            }
          } catch {
            /* state file may not exist yet */
          }
          // Read first unchecked task from tasks.md.
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
  const spinnerFrame = SPINNER_FRAMES[clock % SPINNER_FRAMES.length];
  const now = Date.now();
  const secsToNextPoll = nextPollAtRef.current
    ? Math.max(0, Math.ceil((nextPollAtRef.current - now) / 1000))
    : null;
  const activeCount = coord?.activeCount ?? 0;
  const tailLines = displayTailLines(activeCount);

  return (
    <Box flexDirection="column">
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

      <Box marginTop={1} flexDirection="column">
        {/* Poll status row */}
        <Text dimColor>
          {spinnerFrame}{" "}
          {pollStatus.state === "polling"
            ? `polling Linear (${pollStatus.filterDesc})`
            : pollStatus.lastAt !== null
              ? `last poll: ${pollStatus.lastFound} open, ${pollStatus.lastAdded} new${
                  secsToNextPoll !== null ? ` · next in ${secsToNextPoll}s` : ""
                }`
              : "starting…"}
        </Text>

        {/* Workers summary + sticky settings */}
        <Box>
          <Text dimColor>
            {"  "}workers active: {activeCount} · queued: {coord?.queuedCount ?? 0}
          </Text>
          {cfg && pollStatus.filterDesc && (
            <Text dimColor>
              {"  "}
              {settingsSummary(cfg, pollStatus.filterDesc)}
            </Text>
          )}
        </Box>

        {/* Per-worker cards */}
        {coord?.activeWorkers.map((w) => {
          const meta = workerMetaRef.current.get(w.changeName);
          const elapsed = meta ? fmtElapsed(now - meta.startedAt) : "–";
          const iter = meta?.iter ?? 0;
          const phase = meta?.phase ?? "working";
          const phaseElapsed = meta ? fmtElapsed(now - meta.phaseStartedAt) : "–";
          const phaseDetail = meta?.phaseDetail ? ` (${meta.phaseDetail})` : "";
          const cmd = meta?.currentCmd;
          const cmdElapsed = cmd ? fmtElapsed(now - cmd.startedAt) : null;
          const tail = meta?.tail ?? [];
          const prUrl = meta?.prUrl ?? null;
          const currentTask = meta?.currentTask ?? null;

          const pBadge = priorityBadge(w.issue.priority);
          const mBadge = modeBadge(w.mode);
          const issueTitle = trunc(w.issue.title, 52);
          const pColor = phaseColor(phase);

          return (
            <Box key={w.changeName} flexDirection="column" marginTop={1}>
              {/* Header: priority · identifier · title · [mode] · elapsed · iter */}
              <Box>
                <Text>{"  "}</Text>
                <Text>{spinnerFrame} </Text>
                <Text color={pBadge.color}>{pBadge.text}</Text>
                <Text> </Text>
                <Text color="cyan" bold>
                  {w.issueIdentifier}
                </Text>
                <Text dimColor> · </Text>
                <Text>{issueTitle}</Text>
                <Text dimColor> </Text>
                <Text color={mBadge.color}>[{mBadge.text}]</Text>
                <Text dimColor>
                  {" "}
                  {elapsed} · iter {iter}
                </Text>
              </Box>

              {/* Linear URL */}
              <Text dimColor>
                {"      ↗ "}
                {w.issue.url}
              </Text>

              {/* Current task from tasks.md */}
              {currentTask && (
                <Box>
                  <Text dimColor>{"      ▶ "}</Text>
                  <Text color="white">{trunc(currentTask, 90)}</Text>
                </Box>
              )}

              {/* Phase */}
              <Box>
                <Text dimColor>{"      phase: "}</Text>
                <Text color={pColor}>
                  {phase}
                  {phaseDetail}
                </Text>
                <Text dimColor> · {phaseElapsed}</Text>
              </Box>

              {/* PR URL if available */}
              {prUrl && (
                <Text dimColor>
                  {"      ↗ pr: "}
                  {prUrl}
                </Text>
              )}

              {/* Log file hint */}
              <Text dimColor>
                {"      log: "}
                {meta?.logFile ?? "–"}
              </Text>

              {/* Running command */}
              {cmd && (
                <Text color="yellow">
                  {"      ⏵ "}
                  {fmtCmd(cmd.argv)} · {cmdElapsed}
                </Text>
              )}

              {/* Tail output */}
              {tail.slice(-tailLines).map((line, i) => (
                <Text key={`${w.changeName}-tail-${i}`} dimColor>
                  {"      │ "}
                  {line.length > 110 ? line.slice(0, 109) + "…" : line}
                </Text>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
