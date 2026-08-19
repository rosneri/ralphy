/** Pure string formatters shared by the AgentMode TUI render. */

/** Human-readable elapsed time, e.g. `45s`, `3m07s`, `2h05m`. */
export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${(m % 60).toString().padStart(2, "0")}m`;
}

/** Truncate to `max` characters, appending an ellipsis when shortened. */
export function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Extract a short label from a GitHub PR URL, e.g. "#123". */
export function prLabel(prUrl: string): string {
  const m = prUrl.match(/\/pull\/(\d+)/);
  return m ? `#${m[1]}` : "PR";
}

/** Short badge (text + color) for a worker's spawn mode. */
export function modeBadge(mode: string): { text: string; color: string } {
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
