import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import { join } from "node:path";
import { VERSION, type ParsedArgs } from "../cli";
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
  iter: number;
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

      const { coord, filterDesc, concurrency, pollInterval } = buildAgentCoordinator({
        args,
        cfg,
        projectRoot,
        statesDir,
        tasksDir,
        apiKey,
        onLog: appendLog,
        onWorkersChanged: () => setTick((t) => t + 1),
        onWorkerStarted: (changeName, dir) => {
          workerMetaRef.current.set(changeName, {
            startedAt: Date.now(),
            statesDir: dir,
            iter: 0,
          });
        },
        onWorkerExited: (changeName) => {
          workerMetaRef.current.delete(changeName);
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
          return (
            <Text key={w.changeName} color="cyan">
              {"  "}
              {spinnerFrame} {w.issueIdentifier} ({w.changeName}) · iter {iter} · {elapsed}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
