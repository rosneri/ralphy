import { appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { VERSION } from "@ralphy/version";

const jsonLogChains: Map<string, Promise<void>> = new Map();

type LogType = "session" | "phase" | "coord" | "output";

const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;

export const AGENT_LOG_PATH = join(homedir(), ".ralph", "agent-mode.log");

mkdir(dirname(AGENT_LOG_PATH), { recursive: true }).catch(() => undefined);

function fmt(type: LogType, text: string): string {
  return `[${new Date().toISOString()}] [v${VERSION}] [${type}] ${text}\n`;
}

function write(path: string, line: string): void {
  appendFile(path, line).catch(() => undefined);
}

/** Session boundary (start/stop). Writes to agent log; also to worker log when provided. */
export function logSession(text: string, workerLogFile?: string): void {
  const clean = text.replace(ANSI_RE, "").trim();
  if (!clean) return;
  const line = fmt("session", clean);
  write(AGENT_LOG_PATH, line);
  if (workerLogFile) write(workerLogFile, line);
}

/** Coordinator event (Linear, worktree, labels). Writes to agent log; also to worker log when provided. */
export function logCoord(text: string, workerLogFile?: string): void {
  const clean = text.replace(ANSI_RE, "").trim();
  if (!clean) return;
  const line = fmt("coord", clean);
  write(AGENT_LOG_PATH, line);
  if (workerLogFile) write(workerLogFile, line);
}

/** Phase transition. Writes to agent log + worker log. */
export function logPhase(
  changeName: string,
  workerLogFile: string,
  phase: string,
  detail?: string,
): void {
  const msg = `${changeName}: ${phase}${detail ? ` (${detail})` : ""}`;
  const line = fmt("phase", msg);
  write(AGENT_LOG_PATH, line);
  write(workerLogFile, line);
}

/** Raw worker subprocess output line. Writes to worker log only. */
export function logOutput(workerLogFile: string, text: string): void {
  write(workerLogFile, fmt("output", text));
}

/** Append a JSON event to a `.jsonl` log file, injecting a `ts` timestamp field. */
export function logJsonEvent(logFile: string, event: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), v: VERSION, ...event }) + "\n";
  const prev = jsonLogChains.get(logFile) ?? Promise.resolve();
  const next = prev.then(() => appendFile(logFile, line)).catch(() => undefined);
  jsonLogChains.set(logFile, next);
}

/** Await all pending writes for a given jsonl log file. */
export async function flushJsonLog(logFile: string): Promise<void> {
  await (jsonLogChains.get(logFile) ?? Promise.resolve());
}

/** Truncate/create a log file at the start of a run. */
export async function initWorkerLog(logFile: string): Promise<void> {
  await mkdir(dirname(logFile), { recursive: true });
  await Bun.write(logFile, "");
  jsonLogChains.delete(logFile);
}
