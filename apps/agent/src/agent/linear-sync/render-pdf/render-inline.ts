import type { Tokens } from "marked";

import {
  BODY_SIZE,
  COLOR_INLINE_CODE_FG,
  COLOR_TEXT,
  FONT_BODY,
  FONT_BOLD,
  FONT_BOLD_ITALIC,
  FONT_ITALIC,
  FONT_MONO,
  MARGIN,
} from "./style-constants";
import { toPdfSafe } from "./text-encoding";

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

/** Apply the styling for an inline run to the document so a following
 *  `widthOfString` measurement and `text` draw use the right glyph metrics. */
function applyInlineStyle(doc: PDFKit.PDFDocument, run: InlineRun): void {
  if (run.code) {
    // Inline code must share the body font size: a smaller size shifts the
    // mono fragment onto a raised baseline so it floats above the surrounding
    // text ("different line height").
    doc.font(FONT_MONO).fontSize(BODY_SIZE).fillColor(COLOR_INLINE_CODE_FG);
    return;
  }
  doc.fontSize(BODY_SIZE).fillColor(COLOR_TEXT);
  if (run.bold && run.italic) doc.font(FONT_BOLD_ITALIC);
  else if (run.bold) doc.font(FONT_BOLD);
  else if (run.italic) doc.font(FONT_ITALIC);
  else doc.font(FONT_BODY);
}

interface InlineAtom {
  text: string;
  run: InlineRun;
  space: boolean;
  /** Hard break (from a `<br>` / explicit newline). */
  br: boolean;
}

/** Split styled runs into words, runs of whitespace, and hard breaks, keeping
 *  each piece's style. Whitespace is kept as its own atom so layout can drop a
 *  leading space at the start of a wrapped line. */
function atomizeInline(flat: InlineRun[]): InlineAtom[] {
  const atoms: InlineAtom[] = [];
  for (const run of flat) {
    const safe = toPdfSafe(run.text);
    // Split on newlines and whitespace runs, keeping the delimiters.
    for (const part of safe.split(/(\n|[ \t]+)/)) {
      if (part === "") continue;
      if (part === "\n") atoms.push({ text: "", run, space: false, br: true });
      else if (/^[ \t]+$/.test(part)) atoms.push({ text: part, run, space: true, br: false });
      else atoms.push({ text: part, run, space: false, br: false });
    }
  }
  return atoms;
}

/** Render an inline token sequence as one wrapped paragraph, laying out words
 *  by hand: measure each word with pdfkit's metrics, wrap at the column edge,
 *  and draw every word at an explicit (x, y) with `lineBreak: false`.
 *
 *  This deliberately avoids pdfkit's `continued`-text wrapping, which drops or
 *  overlays the tail of a non-final fragment when that fragment has to wrap
 *  inside a narrow column (RLF-243) — the overlap was only visible once the
 *  list marker narrowed the body column enough to force a mid-fragment wrap. */
export function emitInline(
  doc: PDFKit.PDFDocument,
  tokens: Tokens.Generic[],
  x: number,
  width: number,
): void {
  const flat = flattenInline(tokens);
  if (flat.length === 0) return;
  const atoms = atomizeInline(flat);
  if (atoms.length === 0) return;

  // One uniform line height (body metrics) keeps mixed-font lines on a single
  // grid; mono inline code already shares the body size via applyInlineStyle.
  doc.font(FONT_BODY).fontSize(BODY_SIZE);
  const lineHeight = doc.currentLineHeight(true);
  const right = x + width;
  const bottom = doc.page.height - MARGIN;

  let cursorX = x;
  let cursorY = doc.y;
  let pendingSpace = 0; // width of spaces buffered before the next word

  const newLine = (): void => {
    cursorX = x;
    cursorY += lineHeight;
    pendingSpace = 0;
    if (cursorY + lineHeight > bottom) {
      doc.addPage();
      cursorY = doc.page.margins.top;
    }
  };

  for (const atom of atoms) {
    if (atom.br) {
      newLine();
      continue;
    }
    applyInlineStyle(doc, atom.run);
    if (atom.space) {
      // Trailing/leading spaces at a line start collapse away; otherwise buffer
      // the gap so it only materializes if a word follows on the same line.
      if (cursorX > x) pendingSpace += doc.widthOfString(atom.text);
      continue;
    }
    const wordWidth = doc.widthOfString(atom.text);
    if (cursorX > x && cursorX + pendingSpace + wordWidth > right + 0.01) {
      newLine();
    } else {
      cursorX += pendingSpace;
      pendingSpace = 0;
    }
    applyInlineStyle(doc, atom.run);
    doc.text(atom.text, cursorX, cursorY, { lineBreak: false, continued: false });
    cursorX += wordWidth;
  }

  // Leave the cursor one line below the last row drawn, matching the prior
  // continued-text behavior so block spacing (moveDown) stays consistent.
  doc.y = cursorY + lineHeight;
  doc.font(FONT_BODY).fontSize(BODY_SIZE).fillColor(COLOR_TEXT);
}

export function plainInline(tokens: Tokens.Generic[]): string {
  return flattenInline(tokens)
    .map((r) => r.text)
    .join("");
}
