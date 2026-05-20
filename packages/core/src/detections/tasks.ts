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
