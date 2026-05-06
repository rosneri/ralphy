import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import { join } from "node:path";
import { VERSION, type ParsedArgs } from "../cli";
import { AgentStateStore } from "../agent/state";
import { ensureRalphyConfig, loadRalphyConfig } from "../agent/config";
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
  iter: number;
  phase: string;
  phaseDetail: string;
  phaseStartedAt: number;
  /** In-flight shell command (post-task tracer). null when nothing is running. */
  currentCmd: { argv: string[]; startedAt: number } | null;
  /** Last completed cmd, for "(took 12s)" tail display. */
  lastCmd: { argv: string[]; durationMs: number; ok: boolean } | null;
  /** Ring buffer of last N lines of worker stdout/stderr. */
  tail: string[];
}

const TAIL_MAX_LINES = 5;
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

export function AgentMode({ args, projectRoot, statesDir, tasksDir }: AgentModeProps) {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(0);
  const coordRef = useRef<AgentCoordinator | null>(null);
  const workerMetaRef = useRef<Map<string, WorkerMeta>>(new Map());
  const nextPollAtRef = useRef<number>(0);
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
      appendLog(`agent mode v${VERSION} — config: ${cfgPath}`, "gray");

      const apiKey = process.env["LINEAR_API_KEY"];
      if (!apiKey) {
        appendLog("! LINEAR_API_KEY not set — cannot poll Linear", "red");
        exit();
        return;
      }

      const store = new AgentStateStore(projectRoot);
      await store.load();

      const { coord, filterDesc, concurrency, pollInterval } = buildAgentCoordinator({
        args,
        cfg,
        projectRoot,
        statesDir,
        tasksDir,
        apiKey,
        store,
        onLog: appendLog,
        onWorkersChanged: () => setTick((t) => t + 1),
        onWorkerStarted: (changeName, dir, logFile) => {
          workerMetaRef.current.set(changeName, {
            startedAt: Date.now(),
            statesDir: dir,
            logFile,
            iter: 0,
            phase: "working",
            phaseDetail: "",
            phaseStartedAt: Date.now(),
            currentCmd: null,
            lastCmd: null,
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
          if (m.tail.length > TAIL_MAX_LINES) m.tail.splice(0, m.tail.length - TAIL_MAX_LINES);
        },
        onWorkerCmd: (changeName, cmd, state, durationMs, ok) => {
          const m = workerMetaRef.current.get(changeName);
          if (!m) return;
          if (state === "start") {
            m.currentCmd = { argv: cmd, startedAt: Date.now() };
          } else {
            m.currentCmd = null;
            m.lastCmd = { argv: cmd, durationMs: durationMs ?? 0, ok: ok ?? true };
          }
        },
      });
      appendLog(`concurrency=${concurrency} pollInterval=${pollInterval}s`, "gray");

      coordRef.current = coord;
      await coord.init();

      const tick = async () => {
        if (cancelled) return;
        setPollStatus((p) => ({ ...p, state: "polling", filterDesc }));
        const { found, added } = await coord.pollOnce();
        if (cancelled) return;
        // Only emit a log line when something new was queued — steady-state
        // polls are noisy and visible in the live footer instead.
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
  const spinnerFrame = SPINNER_FRAMES[clock % SPINNER_FRAMES.length];
  const now = Date.now();
  const secsToNextPoll = nextPollAtRef.current
    ? Math.max(0, Math.ceil((nextPollAtRef.current - now) / 1000))
    : null;
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
        <Text dimColor>
          {"  "}workers active: {coord?.activeCount ?? 0} · queued: {coord?.queuedCount ?? 0}
        </Text>
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
          return (
            <Box key={w.changeName} flexDirection="column">
              <Text color="cyan">
                {"  "}
                {spinnerFrame} {w.issueIdentifier} ({w.changeName}) · iter {iter} · {elapsed}
              </Text>
              <Text dimColor>
                {"      phase: "}
                {phase}
                {phaseDetail} · {phaseElapsed}
              </Text>
              {cmd && (
                <Text color="yellow">
                  {"      ⏵ "}
                  {fmtCmd(cmd.argv)} · {cmdElapsed}
                </Text>
              )}
              {tail.map((line, i) => (
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
