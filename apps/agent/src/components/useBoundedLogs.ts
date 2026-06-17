import { useState } from "react";
import { appendBounded } from "@ralphy/core/log-retention";
import { logCoord } from "@ralphy/log";

export interface LogLine {
  id: string;
  text: string;
  timestamp: string;
  color?: string | undefined;
}

/** Local wall-clock stamp prefixed to every scrolling log line (HH:MM:SS). */
export function formatLogTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

let lineCounter = 0;
function nextId(): string {
  lineCounter += 1;
  return `${Date.now()}-${lineCounter}`;
}

/** Append function plus the state a `<Static>` log view needs to render. */
export interface BoundedLogs {
  logs: LogLine[];
  /** Bumped when bounded retention drops oldest lines, so `<Static>` remounts and
   *  keeps flushing new lines (Ink's Static stops once the array stops growing). */
  logTrimGeneration: number;
  appendLog: (text: string, color?: string, workerLogFile?: string) => void;
}

/**
 * Scrolling-log state with bounded in-memory retention. The terminal's native
 * scrollback owns full history; the retained array is capped (appendBounded) so
 * a long or high-volume run does not grow memory unboundedly, and a trim bumps
 * `logTrimGeneration` so the caller can remount `<Static>` to keep flushing.
 */
export function useBoundedLogs(): BoundedLogs {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logTrimGeneration, setLogTrimGeneration] = useState(0);

  function appendLog(text: string, color?: string, workerLogFile?: string): void {
    setLogs((prev) => {
      const { entries, dropped } = appendBounded(prev, [
        { id: nextId(), text, timestamp: formatLogTimestamp(), color },
      ]);
      if (dropped > 0) setLogTrimGeneration((generation) => generation + 1);
      return entries;
    });
    logCoord(text, workerLogFile);
  }

  return { logs, logTrimGeneration, appendLog };
}
