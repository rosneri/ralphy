import type { Tokens } from "marked";

import {
  BODY_SIZE,
  CODE_PADDING_X,
  CODE_PADDING_Y,
  CODE_SIZE,
  COLOR_CODE_BG,
  COLOR_MUTED,
  COLOR_QUOTE_RULE,
  COLOR_RULE,
  COLOR_TEXT,
  FONT_BODY,
  FONT_BOLD,
  FONT_MONO,
  HEADING_SIZES,
  HEADING_TOP_GAP,
  LIST_INDENT,
  MARGIN,
  QUOTE_INDENT,
  QUOTE_RULE_WIDTH,
} from "./style-constants";
import { emitInline, plainInline } from "./render-inline";
import { toPdfSafe } from "./text-encoding";

export function renderTokens(
  doc: PDFKit.PDFDocument,
  tokens: Tokens.Generic[],
  indent: number,
): void {
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
  const textWidth = width - 2 * CODE_PADDING_X;
  doc.font(FONT_MONO).fontSize(CODE_SIZE).fillColor(COLOR_TEXT);
  const lines = text.split(/\r?\n/);

  // Add top padding before the block so the background doesn't overdraw content above.
  doc.y += CODE_PADDING_Y / 2;

  for (const line of lines) {
    const safe = toPdfSafe(line.length > 0 ? line : " ");
    // A line wider than the box wraps within it (pdfkit wraps even with
    // lineBreak:false once a width is set), so reserve its *actual* rendered
    // height: advancing by a single line height would let the next line
    // overdraw the wrapped tail (RLF-243).
    const lineHeight = doc.heightOfString(safe, { width: textWidth, lineBreak: true });
    if (
      doc.y + lineHeight + CODE_PADDING_Y > doc.page.height - MARGIN &&
      doc.y > doc.page.margins.top
    ) {
      doc.addPage();
    }
    const yTop = doc.y;
    doc.rect(x, yTop, width, lineHeight).fill(COLOR_CODE_BG);
    doc.fillColor(COLOR_TEXT);
    doc.text(safe, x + CODE_PADDING_X, yTop, { width: textWidth, lineBreak: true });
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
