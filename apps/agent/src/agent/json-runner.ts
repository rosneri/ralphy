import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { VERSION, type ParsedArgs } from "../cli";
import { ensureRalphyConfig, loadRalphyConfig } from "./config";
import { buildAgentCoordinator } from "./wire";

// Reuse the same line-cleaning regexes as the Ink dashboard.
const ANSI_STRIP_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;
const BOX_ONLY_RE = /^[\s─│╭╮╰╯╌┄━┃]+$/;
const STATUS_BAR_LINE_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗]\s+iter\s+\d+/;
const ITER_HEADER_LINE_RE = /^──/;

function cleanOutputLine(raw: string): string | null {
  const clean = raw.replace(ANSI_STRIP_RE, "").trim();
  if (!clean) return null;
  if (BOX_ONLY_RE.test(clean)) return null;
  if (STATUS_BAR_LINE_RE.test(clean)) return null;
  if (ITER_HEADER_LINE_RE.test(clean)) return null;
  return clean;
}

function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ ts: Date.now(), ...event }) + "\n");
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
 *   stopped          — SIGINT/SIGTERM received; coordinator is stopping
 */
export async function runAgentJson({
  args,
  projectRoot,
  statesDir,
  tasksDir,
}: {
  args: ParsedArgs;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
}): Promise<void> {
  await mkdir(join(homedir(), ".ralph"), { recursive: true }).catch(() => undefined);

  const cfgPath = await ensureRalphyConfig(projectRoot);
  const cfg = await loadRalphyConfig(projectRoot);

  const apiKey = process.env["LINEAR_API_KEY"];
  if (!apiKey) {
    emit({ type: "error", text: "LINEAR_API_KEY not set — cannot poll Linear" });
    process.exitCode = 1;
    return;
  }

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
      emit({ type: "worker_started", changeName, statesDir: dir, logFile, changeDir });
    },
    onWorkerExited: (changeName) => {
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
      emit({ type: "worker_pr", changeName, prUrl });
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

  const tick = async () => {
    if (cancelled) return;
    emit({ type: "poll_start" });
    try {
      await runBaselineGate();
    } catch (err) {
      emit({
        type: "log",
        text: `baseline gate failed: ${(err as Error).message}`,
        color: "yellow",
      });
    }
    if (cancelled) return;
    const { found, added, buckets, prStatus } = await coord.pollOnce();
    if (cancelled) return;
    emit({ type: "poll_done", found, added, buckets, prStatus });
    pollTimer = setTimeout(tick, pollInterval * 1000);
  };
  void tick();

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const onSig = (): void => {
      if (shuttingDown) {
        process.exit(130);
      }
      shuttingDown = true;
      cancelled = true;
      emit({ type: "stopped" });
      coord.stop();
      if (pollTimer) clearTimeout(pollTimer);

      const start = Date.now();
      let warned = false;
      const wait = setInterval(() => {
        const active = coord.activeCount;
        const elapsed = Date.now() - start;
        if (active === 0) {
          clearInterval(wait);
          resolve();
          return;
        }
        if (!warned && elapsed >= 5000) {
          warned = true;
          emit({
            type: "log",
            text: `! ${active} worker(s) still running after 5s — forcing exit at 10s`,
            level: "warn",
          });
        }
        if (elapsed >= 10_000) {
          clearInterval(wait);
          emit({
            type: "log",
            text: `! ${active} worker(s) did not exit within 10s — forcing process exit`,
            level: "warn",
          });
          resolve();
          setTimeout(() => process.exit(1), 50);
        }
      }, 100);
    };
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
  });
}
