/**
 * Text-encoding helpers for the Markdown → PDF renderer. pdfkit's built-in
 * fonts (Helvetica/Courier) only encode WinAnsi (≈CP1252), so any character
 * outside that set must be transliterated to an ASCII look-alike or replaced.
 */

// pdfkit's built-in fonts (Helvetica/Courier) only encode WinAnsi (≈CP1252).
// Any character outside that set is dropped to a mojibake glyph — box-drawing
// renders as "% %", arrows as "!'", etc. We transliterate the common offenders
// (which show up constantly in design-doc data-flow diagrams) to ASCII
// look-alikes, then replace anything still unencodable with "?".
const UNICODE_FALLBACKS: Record<string, string> = {
  // Arrows.
  "→": "->",
  "⟶": "->",
  "➜": "->",
  "➔": "->",
  "↳": "->",
  "↪": "->",
  "⤷": "->",
  "←": "<-",
  "⟵": "<-",
  "↔": "<->",
  "⇒": "=>",
  "⇐": "<=",
  "⇔": "<=>",
  "↑": "^",
  "↓": "v",
  "⬆": "^",
  "⬇": "v",
  // Box drawing — every variant collapses to "|", "-", or "+".
  "─": "-",
  "━": "-",
  "╴": "-",
  "╶": "-",
  "╌": "-",
  "┄": "-",
  "┈": "-",
  "│": "|",
  "┃": "|",
  "║": "|",
  "╎": "|",
  "┆": "|",
  "┊": "|",
  "┌": "+",
  "┍": "+",
  "┎": "+",
  "┏": "+",
  "┐": "+",
  "┑": "+",
  "┒": "+",
  "┓": "+",
  "└": "+",
  "┕": "+",
  "┖": "+",
  "┗": "+",
  "┘": "+",
  "┙": "+",
  "┚": "+",
  "┛": "+",
  "├": "+",
  "┝": "+",
  "┞": "+",
  "┟": "+",
  "┠": "+",
  "┣": "+",
  "┤": "+",
  "┥": "+",
  "┦": "+",
  "┧": "+",
  "┨": "+",
  "┫": "+",
  "┬": "+",
  "┭": "+",
  "┮": "+",
  "┯": "+",
  "┰": "+",
  "┱": "+",
  "┲": "+",
  "┳": "+",
  "┴": "+",
  "┵": "+",
  "┶": "+",
  "┷": "+",
  "┸": "+",
  "┹": "+",
  "┺": "+",
  "┻": "+",
  "┼": "+",
  "╅": "+",
  "╆": "+",
  "╋": "+",
  "╪": "+",
  "╫": "+",
  "╬": "+",
  "╭": "+",
  "╮": "+",
  "╯": "+",
  "╰": "+",
  "╱": "/",
  "╲": "\\",
  "╳": "x",
  "═": "=",
  "╒": "+",
  "╓": "+",
  "╔": "+",
  "╕": "+",
  "╖": "+",
  "╗": "+",
  "╘": "+",
  "╙": "+",
  "╚": "+",
  "╛": "+",
  "╜": "+",
  "╝": "+",
  // Bullets / markers not already in WinAnsi.
  "▸": ">",
  "▶": ">",
  "►": ">",
  "◀": "<",
  "◦": "-",
  "▪": "-",
  "▫": "-",
  "■": "-",
  "□": "-",
  "●": "-",
  "○": "-",
  "◆": "-",
  "◇": "-",
  // Checks / stars.
  "✓": "[x]",
  "✔": "[x]",
  "✗": "[ ]",
  "✘": "[ ]",
  "★": "*",
  "☆": "*",
  // Math / comparison.
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "≈": "~",
  "×": "x",
  "÷": "/",
  "±": "+/-",
  "∞": "inf",
  "√": "sqrt",
  "·": "-",
  // Whitespace.
  "\t": "    ",
  " ": " ",
  " ": " ",
  " ": " ",
};

// Codepoints reachable through WinAnsi's 0x80–0x9F range (curly quotes, dashes,
// the bullet, ellipsis, trademark, …). These are > 0xFF yet still encodable, so
// they must survive sanitization untouched.
const WINANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function isWinAnsi(cp: number): boolean {
  if (cp === 0x0a || cp === 0x0d) return true; // newlines flow through unchanged
  if (cp >= 0x20 && cp <= 0x7e) return true; // ASCII printable
  if (cp >= 0xa0 && cp <= 0xff) return true; // Latin-1 supplement
  return WINANSI_EXTRA.has(cp);
}

/** Make `text` safe for pdfkit's built-in fonts: transliterate known Unicode
 *  to ASCII, then replace any remaining unencodable glyph with "?". */
export function toPdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = UNICODE_FALLBACKS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    out += isWinAnsi(ch.codePointAt(0) ?? 0) ? ch : "?";
  }
  return out;
}
