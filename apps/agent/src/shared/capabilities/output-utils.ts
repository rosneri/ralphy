export const ANSI_STRIP_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;
export const BOX_ONLY_RE = /^[\s─│╭╮╰╯╌┄━┃]+$/;
export const STATUS_BAR_LINE_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗]\s+iter\s+\d+/;
export const ITER_HEADER_LINE_RE = /^──/;

export function cleanOutputLine(raw: string): string | null {
  const clean = raw.replace(ANSI_STRIP_RE, "").trim();
  if (!clean) return null;
  if (BOX_ONLY_RE.test(clean)) return null;
  if (STATUS_BAR_LINE_RE.test(clean)) return null;
  if (ITER_HEADER_LINE_RE.test(clean)) return null;
  return clean;
}
