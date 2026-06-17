/**
 * Bounded retention for live feed/log entries.
 *
 * The recurring 16G OOM (see scripts/oom-trace.sh, PR history) was unbounded
 * in-memory accumulation of engine output in the worker process: every `feed`
 * event was kept forever in React state (`useLoop` logLines) and each entry
 * held its full text, which Ink then measured and wrapped. A single worker
 * iteration that streamed high-volume output could spike the process to many
 * gigabytes in seconds. These helpers bound both axes — how many entries are
 * retained, and how large any one entry's text may be — so a runaway iteration
 * can no longer exhaust memory. Already-printed lines remain in the terminal
 * scrollback and the full record is preserved in the JSON log file; only the
 * live in-memory copy is capped.
 */

/** Max number of feed/log entries kept in memory for the live view. */
export const MAX_RETAINED_LOG_ENTRIES = 5000;

/** Max characters retained for a single feed entry's text payload. */
export const MAX_FEED_TEXT_CHARS = 64 * 1024;

export interface BoundedAppendResult<T> {
  /** The retained entries, capped to `max`. */
  entries: T[];
  /** How many oldest entries were dropped to stay within `max`. */
  dropped: number;
}

/**
 * Append `next` to `prev`, keeping at most `max` of the most-recent entries.
 * Returns the dropped count so a caller can remount an append-only renderer
 * (Ink's `<Static>` tracks the last-seen length and would otherwise stop
 * rendering once the array stops growing).
 */
export function appendBounded<T>(
  prev: readonly T[],
  next: readonly T[],
  max: number = MAX_RETAINED_LOG_ENTRIES,
): BoundedAppendResult<T> {
  if (next.length === 0) return { entries: prev as T[], dropped: 0 };
  const combined = [...prev, ...next];
  if (combined.length <= max) return { entries: combined, dropped: 0 };
  const dropped = combined.length - max;
  return { entries: combined.slice(dropped), dropped };
}

/**
 * Truncate a single entry's text to `max` characters, appending a marker that
 * names how much was dropped. Short text passes through untouched.
 */
export function truncateForDisplay(text: string, max: number = MAX_FEED_TEXT_CHARS): string {
  if (text.length <= max) return text;
  const dropped = text.length - max;
  return `${text.slice(0, max)}\n… (truncated ${dropped} more chars)`;
}
