/**
 * Notion-inspired Markdown → PDF renderer used by spec-attachments
 * when the workflow opts into the "pdf" attachment format. Parses
 * Markdown via `marked`, walks the token tree, and emits styled
 * blocks via pdfkit:
 *
 *   - Headings (H1–H6) with descending size and tight bottom margin
 *   - Paragraphs with inline bold / italic / inline code
 *   - Bullet + ordered lists with nested indent
 *   - Fenced code blocks with a soft gray background, per-line
 *     (so they paginate cleanly)
 *   - Blockquotes with a left rule
 *   - Horizontal rules
 *
 * The styling tracks Notion's defaults loosely: Helvetica body in a
 * dark grey, light-grey backgrounds for code, generous block spacing.
 * No external fonts beyond pdfkit's built-ins, so this works in any
 * Bun environment without a browser or font dependency.
 */

import PDFDocument from "pdfkit";
import { marked, type Tokens } from "marked";

const PAGE_SIZE = "LETTER" as const;
const MARGIN = 54; // 0.75in

// Notion-ish palette.
const COLOR_TEXT = "#37352F";
const COLOR_MUTED = "#787774";
const COLOR_RULE = "#E9E9E7";
const COLOR_CODE_BG = "#F7F6F3";
const COLOR_INLINE_CODE_FG = "#EB5757";
const COLOR_QUOTE_RULE = "#37352F";

// Typography.
const FONT_BODY = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_ITALIC = "Helvetica-Oblique";
const FONT_BOLD_ITALIC = "Helvetica-BoldOblique";
const FONT_MONO = "Courier";

const BODY_SIZE = 10.5;
const CODE_SIZE = 9;
const HEADING_SIZES: Record<number, number> = { 1: 24, 2: 18, 3: 14, 4: 12, 5: 11, 6: 10.5 };
const HEADING_TOP_GAP: Record<number, number> = { 1: 12, 2: 10, 3: 8, 4: 6, 5: 4, 6: 4 };

const LIST_INDENT = 16;
const QUOTE_INDENT = 14;
const QUOTE_RULE_WIDTH = 3;
const CODE_PADDING_X = 8;
const CODE_PADDING_Y = 6;

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
function toPdfSafe(text: string): string {
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

/** Render the given Markdown text to a PDF byte buffer. Resolves with
 *  Uint8Array suitable for direct upload via `uploadFileToLinear`. */
export function renderMarkdownToPdf(md: string, title: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: PAGE_SIZE,
        margin: MARGIN,
        info: { Title: title },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      doc.on("error", reject);

      doc.fillColor(COLOR_TEXT).font(FONT_BODY).fontSize(BODY_SIZE);

      const tokens = marked.lexer(md);
      renderTokens(doc, tokens as Tokens.Generic[], 0);
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

function renderTokens(doc: PDFKit.PDFDocument, tokens: Tokens.Generic[], indent: number): void {
  for (const token of tokens) {
    renderBlock(doc, token, indent);
  }
}

function renderBlock(doc: PDFKit.PDFDocument, token: Tokens.Generic, indent: number): void {
  switch (token.type) {
    case "heading":
      renderHeading(doc, token as Tokens.Heading, indent);
      return;
    case "paragraph":
      renderParagraph(doc, token as Tokens.Paragraph, indent);
      return;
    case "list":
      renderList(doc, token as Tokens.List, indent);
      return;
    case "code":
      renderCodeBlock(doc, token as Tokens.Code, indent);
      return;
    case "blockquote":
      renderBlockquote(doc, token as Tokens.Blockquote, indent);
      return;
    case "hr":
      renderHr(doc, indent);
      return;
    case "space":
      doc.moveDown(0.4);
      return;
    case "html":
      renderCodeBlock(
        doc,
        { type: "code", raw: token.raw, text: token.raw, lang: "html" } as Tokens.Code,
        indent,
      );
      return;
    default:
      // Catch-all for token kinds the renderer hasn't special-cased
      // (e.g. table, def). Fall back to emitting the raw text if any,
      // so nothing is silently dropped.
      if (hasTextField(token)) {
        renderParagraph(
          doc,
          {
            type: "paragraph",
            raw: token.raw,
            text: token.text,
            tokens: [{ type: "text", raw: token.raw, text: token.text } as Tokens.Text],
          } as Tokens.Paragraph,
          indent,
        );
      }
  }
}

function hasTextField(token: Tokens.Generic): token is Tokens.Generic & { text: string } {
  const candidate = (token as { text?: unknown }).text;
  return typeof candidate === "string";
}

function renderHeading(doc: PDFKit.PDFDocument, token: Tokens.Heading, indent: number): void {
  const level = Math.min(Math.max(token.depth, 1), 6);
  const size = HEADING_SIZES[level] ?? BODY_SIZE;
  doc.moveDown(HEADING_TOP_GAP[level]! / BODY_SIZE);
  doc.font(FONT_BOLD).fontSize(size).fillColor(COLOR_TEXT);
  const x = MARGIN + indent;
  const width = doc.page.width - 2 * MARGIN - indent;
  doc.text(toPdfSafe(plainInline(token.tokens ?? [])), x, doc.y, { width });
  doc.moveDown(0.3);
  doc.font(FONT_BODY).fontSize(BODY_SIZE).fillColor(COLOR_TEXT);
}

function renderParagraph(doc: PDFKit.PDFDocument, token: Tokens.Paragraph, indent: number): void {
  const x = MARGIN + indent;
  const width = doc.page.width - 2 * MARGIN - indent;
  emitInline(doc, token.tokens ?? [], x, width);
  doc.moveDown(0.5);
}

function renderList(doc: PDFKit.PDFDocument, token: Tokens.List, indent: number): void {
  const ordered = token.ordered;
  const start = typeof token.start === "number" ? token.start : 1;
  token.items.forEach((item, i) => {
    renderListItem(doc, item, indent, ordered ? `${start + i}.` : "•");
  });
  doc.moveDown(0.2);
}

function renderListItem(
  doc: PDFKit.PDFDocument,
  item: Tokens.ListItem,
  indent: number,
  marker: string,
): void {
  const x = MARGIN + indent;
  const markerWidth = 14;
  doc.font(FONT_BODY).fontSize(BODY_SIZE).fillColor(COLOR_MUTED);
  doc.text(marker, x, doc.y, { width: markerWidth, continued: false });
  const startY = doc.y - doc.currentLineHeight();
  const bodyX = x + markerWidth;
  const bodyWidth = doc.page.width - 2 * MARGIN - indent - markerWidth;
  doc.fillColor(COLOR_TEXT);

  const tokens = item.tokens ?? [];
  let inlineRun: Tokens.Generic[] = [];
  let placedInline = false;
  let renderedBlock = false;
  const placeInline = (): void => {
    if (inlineRun.length === 0) return;
    if (!placedInline) {
      doc.y = startY;
      emitInline(doc, inlineRun, bodyX, bodyWidth);
      placedInline = true;
    } else {
      emitInline(doc, inlineRun, bodyX, bodyWidth);
    }
    inlineRun = [];
  };

  for (const tok of tokens) {
    if (tok.type === "text") {
      const text = tok as Tokens.Text;
      if (text.tokens && text.tokens.length > 0) {
        inlineRun.push(...(text.tokens as Tokens.Generic[]));
      } else {
        inlineRun.push({ type: "text", raw: text.raw, text: text.text } as Tokens.Generic);
      }
      continue;
    }
    placeInline();
    // In a loose list the item's first child is a block (paragraph / nested
    // list), so no inline run was placed and doc.y still points one line below
    // the marker. Pull it back up to the marker line so the first block aligns
    // with the bullet; later blocks flow naturally from there.
    if (!placedInline && !renderedBlock) doc.y = startY;
    renderBlock(doc, tok, indent + LIST_INDENT);
    renderedBlock = true;
  }
  placeInline();

  // Only a genuinely empty item (bare marker, no inline and no block content)
  // needs the cursor-reset filler. Doing this after blocks rendered would snap
  // the cursor back up and overdraw the item's own content (RLF-225).
  if (!placedInline && !renderedBlock) {
    doc.y = startY;
    doc.text(" ", bodyX, startY, { width: bodyWidth });
  }
}

function renderCodeBlock(doc: PDFKit.PDFDocument, token: Tokens.Code, indent: number): void {
  const text = token.text ?? "";
  const x = MARGIN + indent;
  const width = doc.page.width - 2 * MARGIN - indent;
  doc.font(FONT_MONO).fontSize(CODE_SIZE).fillColor(COLOR_TEXT);
  const lineHeight = doc.currentLineHeight(true);
  const lines = text.split(/\r?\n/);

  // Add top padding before the block so the background doesn't overdraw content above.
  doc.y += CODE_PADDING_Y / 2;

  for (const line of lines) {
    if (doc.y + lineHeight + CODE_PADDING_Y > doc.page.height - MARGIN) {
      doc.addPage();
    }
    const yTop = doc.y;
    const safe = toPdfSafe(line);
    doc.rect(x, yTop, width, lineHeight).fill(COLOR_CODE_BG);
    doc.fillColor(COLOR_TEXT);
    doc.text(safe.length > 0 ? safe : " ", x + CODE_PADDING_X, yTop, {
      width: width - 2 * CODE_PADDING_X,
      lineBreak: false,
    });
    doc.y = yTop + lineHeight;
  }

  // Bottom padding after the block.
  doc.y += CODE_PADDING_Y / 2;
  doc.moveDown(0.5);
  doc.font(FONT_BODY).fontSize(BODY_SIZE).fillColor(COLOR_TEXT);
}

function renderBlockquote(doc: PDFKit.PDFDocument, token: Tokens.Blockquote, indent: number): void {
  const startY = doc.y;
  const x = MARGIN + indent;
  renderTokens(doc, (token.tokens ?? []) as Tokens.Generic[], indent + QUOTE_INDENT);
  const endY = doc.y;
  doc.save();
  doc
    .rect(x, startY, QUOTE_RULE_WIDTH, Math.max(endY - startY - 2, 8))
    .fillColor(COLOR_QUOTE_RULE)
    .fill();
  doc.restore();
  doc.fillColor(COLOR_TEXT);
}

function renderHr(doc: PDFKit.PDFDocument, indent: number): void {
  doc.moveDown(0.5);
  const x = MARGIN + indent;
  const width = doc.page.width - 2 * MARGIN - indent;
  doc.save();
  doc
    .lineWidth(0.5)
    .strokeColor(COLOR_RULE)
    .moveTo(x, doc.y)
    .lineTo(x + width, doc.y)
    .stroke();
  doc.restore();
  doc.moveDown(0.8);
}

interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}

function flattenInline(
  tokens: Tokens.Generic[],
  flags: { bold?: boolean; italic?: boolean } = {},
): InlineRun[] {
  const out: InlineRun[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "text": {
        const t = tok as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) {
          out.push(...flattenInline(t.tokens as Tokens.Generic[], flags));
        } else {
          out.push({
            text: t.text,
            bold: flags.bold ?? false,
            italic: flags.italic ?? false,
            code: false,
          });
        }
        break;
      }
      case "strong":
        out.push(
          ...flattenInline(((tok as Tokens.Strong).tokens ?? []) as Tokens.Generic[], {
            ...flags,
            bold: true,
          }),
        );
        break;
      case "em":
        out.push(
          ...flattenInline(((tok as Tokens.Em).tokens ?? []) as Tokens.Generic[], {
            ...flags,
            italic: true,
          }),
        );
        break;
      case "codespan":
        out.push({
          text: (tok as Tokens.Codespan).text,
          bold: false,
          italic: false,
          code: true,
        });
        break;
      case "link": {
        const l = tok as Tokens.Link;
        out.push(...flattenInline((l.tokens ?? []) as Tokens.Generic[], flags));
        break;
      }
      case "br":
        out.push({ text: "\n", bold: false, italic: false, code: false });
        break;
      default: {
        const fallback = (tok as { text?: string; raw?: string }).text ?? tok.raw ?? "";
        if (fallback) {
          out.push({
            text: fallback,
            bold: flags.bold ?? false,
            italic: flags.italic ?? false,
            code: false,
          });
        }
      }
    }
  }
  return out;
}

/** Render an inline token sequence using pdfkit's continued-text API so
 *  a run of mixed styles wraps as one visual paragraph. */
function emitInline(
  doc: PDFKit.PDFDocument,
  tokens: Tokens.Generic[],
  x: number,
  width: number,
): void {
  const flat = flattenInline(tokens);
  if (flat.length === 0) return;
  for (let i = 0; i < flat.length; i++) {
    const run = flat[i]!;
    const last = i === flat.length - 1;
    const opts: PDFKit.Mixins.TextOptions = {
      width,
      continued: !last,
      lineBreak: true,
    };
    if (run.code) {
      // Inline code must share the body font size: a smaller size inside a
      // `continued` run shifts the mono fragment onto a raised baseline, so it
      // visibly floats above the surrounding text ("different line height").
      doc.font(FONT_MONO).fontSize(BODY_SIZE).fillColor(COLOR_INLINE_CODE_FG);
    } else {
      doc.fontSize(BODY_SIZE).fillColor(COLOR_TEXT);
      if (run.bold && run.italic) doc.font(FONT_BOLD_ITALIC);
      else if (run.bold) doc.font(FONT_BOLD);
      else if (run.italic) doc.font(FONT_ITALIC);
      else doc.font(FONT_BODY);
    }

    const safe = toPdfSafe(run.text);
    if (i === 0) {
      doc.text(safe, x, doc.y, opts);
    } else {
      doc.text(safe, opts);
    }
  }
  doc.font(FONT_BODY).fontSize(BODY_SIZE).fillColor(COLOR_TEXT);
}

function plainInline(tokens: Tokens.Generic[]): string {
  return flattenInline(tokens)
    .map((r) => r.text)
    .join("");
}
