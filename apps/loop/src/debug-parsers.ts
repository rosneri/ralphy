/**
 * Log parsers and stuck-loop detection for `ralph debug`.
 *
 * These are pure functions over already-read log content: they turn the text
 * agent log and the project-level JSONL log into a normalized `DebugLogLine[]`
 * and detect when the loop is stuck repeating a single phase. The orchestration
 * in debug.ts consumes them.
 */

import type { RalphEvent } from "@ralphy/events";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface DebugLogLine {
  ts: Date;
  type: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Text log parsing (format: "[ISO-TS] [type] message")
// ---------------------------------------------------------------------------

const LOG_LINE_RE = /^\[(.+?)\] \[(.+?)\] (.+)$/;

export function parseTextLog(content: string): DebugLogLine[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const m = LOG_LINE_RE.exec(line);
      if (!m) return [];
      const ts = new Date(m[1]!);
      if (isNaN(ts.getTime())) return [];
      return [{ ts, type: m[2]!, text: m[3]! }];
    });
}

// ---------------------------------------------------------------------------
// JSONL log parsing (format: {"ts":epoch_ms, "type":string, ...})
// Used by the project-level agent.log when running in JSON/dashboard mode.
// ---------------------------------------------------------------------------

// The project-level `agent.log` persists `RalphEvent` values as JSONL, so the
// reader's view is derived straight from the canonical union (RLF-254) rather
// than re-declaring each field. `prUrl` is the pre-8a name for `worker_pr`'s
// `url`; it is intersected back in here — and ONLY here — so historical log
// lines written before the rename still render.
type JsonlEntry = RalphEvent & { prUrl?: string };

export function parseJsonlLog(content: string, filterChangeName?: string): DebugLogLine[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      let entry: JsonlEntry;
      try {
        entry = JSON.parse(line) as JsonlEntry;
      } catch {
        return [];
      }

      const ts = new Date(entry.ts);
      if (isNaN(ts.getTime())) return [];

      const changeName = "changeName" in entry ? entry.changeName : undefined;

      // If filtering by changeName, skip entries for other changes
      if (filterChangeName && changeName && changeName !== filterChangeName) {
        return [];
      }

      const cn = changeName ?? "";

      switch (entry.type) {
        case "started":
          return [{ ts, type: "agent", text: `agent started v${entry.version ?? "?"}` }];
        case "stopped":
          return [{ ts, type: "agent", text: "agent stopped" }];
        case "worker_started":
          return [{ ts, type: "spawn", text: `${cn}: worker spawned` }];
        case "worker_phase": {
          const detail = entry.detail ? ` (${entry.detail})` : "";
          return [{ ts, type: "phase", text: `${cn}: ${entry.phase}${detail}` }];
        }
        case "worker_cmd_start":
          return [
            {
              ts,
              type: "cmd",
              text: `${cn}: → ${(entry.cmd ?? []).slice(0, 4).join(" ")}`,
            },
          ];
        case "worker_cmd_end":
          return [
            {
              ts,
              type: "cmd",
              text: `${cn}: ← ${(entry.cmd ?? []).slice(0, 2).join(" ")} (${entry.durationMs}ms, ${entry.ok ? "ok" : "err"})`,
            },
          ];
        case "worker_pr":
          return [{ ts, type: "pr", text: `${cn}: PR → ${entry.url ?? entry.prUrl}` }];
        case "worker_exited":
          return [
            {
              ts,
              type: "exit",
              text: `${cn}: exited (code ${entry.exitCode ?? "?"})`,
            },
          ];
        case "log":
          return [{ ts, type: "coord", text: entry.text ?? "" }];
        case "poll_done":
          return [
            {
              ts,
              type: "poll",
              text: `poll: found=${entry.found} added=${entry.added}`,
            },
          ];
        default:
          return [];
      }
    });
}

// ---------------------------------------------------------------------------
// Stuck-loop detection
// ---------------------------------------------------------------------------

export interface StuckInfo {
  phase: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  minutesStuck: number;
  watchingPrUrl: string | undefined;
}

export function detectDebugStuck(lines: DebugLogLine[]): StuckInfo | null {
  if (lines.length < 10) return null;

  // Count repeats of the same phase in the last 20 entries
  const recent = lines.slice(-20).filter((l) => l.type === "phase");
  if (recent.length < 5) return null;

  const phaseNames = recent.map((l) => l.text.split(": ").slice(1).join(": "));
  const unique = new Set(phaseNames);
  if (unique.size !== 1) return null;

  const phase = phaseNames[0]!;

  // Count total occurrences across the full timeline
  const all = lines.filter((l) => l.type === "phase" && l.text.includes(phase));
  const first = all[0]!;
  const last = all[all.length - 1]!;
  const minutesStuck = (last.ts.getTime() - first.ts.getTime()) / 60_000;

  // Extract the PR URL being polled (from pr-type entries or cmd entries)
  const prEntry = lines.find((l) => l.type === "pr");
  const cmdEntry = lines.find(
    (l) => l.type === "cmd" && l.text.includes("gh") && l.text.includes("mergeable"),
  );
  const watchingPrUrl =
    prEntry?.text.split("PR → ")[1] ?? cmdEntry?.text.match(/https:\/\/github\.com\/[^\s)]+/)?.[0];

  return {
    phase,
    count: all.length,
    firstSeen: first.ts,
    lastSeen: last.ts,
    minutesStuck,
    watchingPrUrl,
  };
}
