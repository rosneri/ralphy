/**
 * Pure helpers for inspecting a `tasks.md` document.
 *
 * Both functions operate on the raw markdown string; the caller is
 * responsible for reading the file from disk.
 */

export function hasUnchecked(content: string): boolean {
  return /^- \[ \]/m.test(content);
}

export function allChecked(content: string): boolean {
  if (content.trim() === "") return false;
  return !/^- \[ \]/m.test(content);
}

/**
 * True when the `## Planning` section of `content` has at least one
 * checkbox and every checkbox in it is checked.
 *
 * Returns `true` when no Planning section is found (planning is N/A for
 * this tasks file — the check is skipped, not failed).
 */
export function planningComplete(content: string): boolean {
  const lines = content.split(/\r?\n/);
  let inPlanning = false;
  let total = 0;
  let unchecked = 0;
  for (const line of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      inPlanning = h[1]!.trim().toLowerCase() === "planning";
      continue;
    }
    if (!inPlanning) continue;
    const m = /^\s*-\s+\[( |x|X)\]/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] === " ") unchecked += 1;
  }
  return total === 0 || unchecked === 0;
}
