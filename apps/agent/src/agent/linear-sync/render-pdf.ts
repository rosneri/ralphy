/**
 * Notion-inspired Markdown → PDF renderer used by spec-attachments
 * when the workflow opts into the "pdf" attachment format. Parses
 * Markdown via `marked`, walks the token tree, and emits styled
 * blocks via pdfkit:
 *
 * - Headings (H1–H6) at descending size with a tight bottom margin
 * - Paragraphs with inline bold / italic / inline code
 * - Bullet + ordered lists with nested indent
 * - Fenced code blocks on a soft gray background, drawn per-line
 *   (so they paginate cleanly)
 * - Blockquotes with a left rule
 * - Horizontal rules
 *
 * The styling tracks Notion's defaults loosely: Helvetica body in a
 * dark grey, light-grey backgrounds for code, generous block spacing.
 * No external fonts beyond pdfkit's built-ins, so this works in any
 * Bun environment without a browser or font dependency.
 */

import PDFDocument from "pdfkit";
import { marked, type Tokens } from "marked";

import { BODY_SIZE, COLOR_TEXT, FONT_BODY, MARGIN, PAGE_SIZE } from "./render-pdf/style-constants";
import { renderTokens } from "./render-pdf/render-tokens";

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
