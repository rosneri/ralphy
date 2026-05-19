/**
 * Pure-JS Markdown → PDF renderer used by spec-attachments when the
 * workflow opts into the "pdf" attachment format. Output is plain but
 * legible: monospace body, slightly larger bold lines for ATX headings,
 * automatic page breaks. We deliberately avoid headless-browser
 * rendering so this works in any Bun environment without binary deps
 * beyond pdfkit.
 */

import PDFDocument from "pdfkit";

const PAGE_SIZE = "LETTER" as const;
const MARGIN = 54; // 0.75in
const BODY_FONT = "Courier";
const HEADING_FONT = "Courier-Bold";
const BODY_SIZE = 10;
const HEADING_SIZES: Record<number, number> = { 1: 18, 2: 15, 3: 13, 4: 12, 5: 11, 6: 11 };

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

      writeMarkdown(doc, md);
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

function writeMarkdown(doc: PDFKit.PDFDocument, md: string): void {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      doc.moveDown(level === 1 ? 0.5 : 0.3);
      doc
        .font(HEADING_FONT)
        .fontSize(HEADING_SIZES[level] ?? BODY_SIZE)
        .text(text);
      doc.moveDown(0.3);
      continue;
    }
    doc.font(BODY_FONT).fontSize(BODY_SIZE);
    if (line.trim().length === 0) {
      doc.moveDown(0.4);
      continue;
    }
    doc.text(line);
  }
}
