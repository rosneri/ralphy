import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import { renderMarkdownToPdf } from "../agent/linear-sync/render-pdf";

/** Inflate every content stream in a pdfkit PDF and pull out one record per
 *  text-showing operator: the font resource, font size, and baseline y from
 *  the active text matrix. Lets a test assert *where* glyphs actually land —
 *  e.g. that inline code shares the body text baseline. */
function textRuns(pdf: Uint8Array): Array<{ font: string; size: number; y: number; page: number }> {
  const buf = Buffer.from(pdf);
  const s = buf.toString("latin1");
  const runs: Array<{ font: string; size: number; y: number; page: number }> = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  // One content stream per page in pdfkit; bump the page index for every stream
  // that actually emitted text so callers can scope per-page invariants.
  let page = 0;
  while ((m = streamRe.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    let content: string;
    try {
      content = zlib.inflateSync(buf.subarray(start, end)).toString("latin1");
    } catch {
      continue;
    }
    let font = "";
    let size = 0;
    let y = 0;
    let produced = false;
    const tok = /1 0 0 1 [\d.-]+ ([\d.-]+) Tm|\/(F\d+) ([\d.-]+) Tf|\b(TJ|Tj)\b/g;
    let t: RegExpExecArray | null;
    while ((t = tok.exec(content))) {
      if (t[1] !== undefined) y = parseFloat(t[1]);
      else if (t[2] !== undefined) {
        font = t[2];
        size = parseFloat(t[3]!);
      } else {
        runs.push({ font, size, y, page });
        produced = true;
      }
    }
    if (produced) page++;
  }
  return runs;
}

/** Largest amount (pt) any baseline sits ABOVE the lowest baseline already
 *  drawn earlier on the same page, in draw order. In pdfkit's Tm space a larger
 *  y is higher on the page, so text should descend (y monotonically falls);
 *  a positive return value means the cursor jumped back up and overdrew earlier
 *  content — the RLF-225 loose-list overlay bug. */
function maxBacktrack(runs: Array<{ y: number; page: number }>): number {
  let worst = 0;
  const lowestByPage = new Map<number, number>();
  for (const r of runs) {
    const lowest = lowestByPage.get(r.page);
    if (lowest !== undefined) worst = Math.max(worst, r.y - lowest);
    lowestByPage.set(r.page, lowest === undefined ? r.y : Math.min(lowest, r.y));
  }
  return worst;
}

async function extractText(pdf: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  return (await parser.getText()).text;
}

// Like textRuns but also recovers each fragment's start x and its decoded
// glyph text, mapping the /Fn resource back to its BaseFont so the fragment's
// rendered width can be measured with pdfkit's own metrics. Lets a test assert
// that no two fragments sharing a baseline overlap horizontally — the visual
// "text over text" failure mode that text-only extraction cannot see (the
// glyphs are all present, just stacked).
interface XRun {
  x: number;
  y: number;
  size: number;
  base: string;
  text: string;
  page: number;
}

function textRunsX(pdf: Uint8Array): XRun[] {
  const buf = Buffer.from(pdf);
  const s = buf.toString("latin1");
  // /Fn -> object number -> BaseFont name.
  const fontMap = new Map<string, string>();
  for (const ref of s.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
    const obj = new RegExp(`\\b${ref[2]}\\s+0\\s+obj([\\s\\S]*?)endobj`).exec(s);
    const base = obj && /\/BaseFont\s*\/([A-Za-z-]+)/.exec(obj[1]!);
    if (base) fontMap.set(ref[1]!, base[1]!);
  }
  const runs: XRun[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let page = 0;
  while ((m = streamRe.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    let content: string;
    try {
      content = zlib.inflateSync(buf.subarray(start, end)).toString("latin1");
    } catch {
      continue;
    }
    let x = 0;
    let y = 0;
    let base = "Helvetica";
    let size = 0;
    let produced = false;
    const tok =
      /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm|\/(F\d+) ([\d.-]+) Tf|\[<([0-9a-fA-F]*)>[^\]]*\]\s*TJ/g;
    let t: RegExpExecArray | null;
    while ((t = tok.exec(content))) {
      if (t[1] !== undefined) {
        x = parseFloat(t[1]);
        y = parseFloat(t[2]!);
      } else if (t[3] !== undefined) {
        base = fontMap.get(t[3]) ?? "Helvetica";
        size = parseFloat(t[4]!);
      } else {
        const hex = t[5]!;
        let text = "";
        for (let i = 0; i < hex.length; i += 2) {
          text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
        if (text.trim().length > 0) runs.push({ x, y, size, base, text, page });
        produced = true;
      }
    }
    if (produced) page++;
  }
  return runs;
}

/** Largest horizontal overlap (pt) between two text fragments that share a
 *  baseline (within 2pt, to absorb the Courier↔Helvetica ascender jitter
 *  between mixed-font fragments on one visual line). A large value means one
 *  fragment was drawn on top of the next — the RLF-243 inline-code overlap. */
/** Minimal slice of the pdfkit document used purely to measure glyph widths.
 *  pdfkit ships no type declarations, so the untyped default export is pinned
 *  to this precise shape rather than left as `any`. */
interface PdfMeter {
  font(f: string): unknown;
  fontSize(n: number): unknown;
  widthOfString(s: string): number;
}

function maxHorizontalOverlap(runs: XRun[]): number {
  const meter: PdfMeter = new PDFDocument();
  const widthOf = (r: XRun): number => {
    meter.font(r.base);
    meter.fontSize(r.size);
    return meter.widthOfString(r.text);
  };
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  let worst = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    const { y, page } = sorted[i]!;
    while (j < sorted.length && sorted[j]!.page === page && Math.abs(sorted[j]!.y - y) <= 2) j++;
    const line = sorted.slice(i, j).sort((a, b) => a.x - b.x);
    for (let k = 1; k < line.length; k++) {
      const prev = line[k - 1]!;
      const cur = line[k]!;
      worst = Math.max(worst, prev.x + widthOf(prev) - cur.x);
    }
    i = j;
  }
  return worst;
}

const SAMPLE = `# Title

Intro paragraph with **bold**, *italic*, and \`inline code\`.

## Subhead

- bullet one
- bullet two with \`code\`
  - nested bullet
- bullet three

1. first
2. second

\`\`\`ts
function hello(name: string): void {
  console.log("hi " + name);
}
\`\`\`

> Blockquote line one
> Blockquote line two

---

Trailing paragraph.
`;

describe("renderMarkdownToPdf", () => {
  test("produces a non-empty PDF with the %PDF magic prefix", async () => {
    const out = await renderMarkdownToPdf(SAMPLE, "Sample");
    expect(out.byteLength).toBeGreaterThan(500);
    expect(new TextDecoder().decode(out.slice(0, 4))).toBe("%PDF");
  });

  test("the rendered PDF references the expected fonts (body, bold, italic, mono)", async () => {
    const out = await renderMarkdownToPdf(SAMPLE, "Sample");
    // pdfkit FlateDecodes text content streams, but font definitions land
    // unchanged in the catalog. If the renderer fails to switch fonts for
    // headings/code/em, those entries won't appear.
    const haystack = new TextDecoder("latin1").decode(out);
    for (const font of ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Courier"]) {
      expect(haystack).toContain(font);
    }
    // PDF Title metadata is stored as a literal string; confirms the
    // pipeline reached doc.end() with the title plumbed through.
    expect(haystack).toContain("(Sample)");
  });

  test("handles empty markdown without throwing", async () => {
    const out = await renderMarkdownToPdf("", "Empty");
    expect(out.byteLength).toBeGreaterThan(200);
    expect(new TextDecoder().decode(out.slice(0, 4))).toBe("%PDF");
  });

  test("renders blockquotes and ordered lists without throwing", async () => {
    const md = `> first quote
> with a continuation
>
> and a second paragraph

1. step one
2. step two — has [a link](https://example.com) inline
3. step three with a hard\\
break in it
`;
    const out = await renderMarkdownToPdf(md, "Quotes");
    expect(out.byteLength).toBeGreaterThan(500);
    expect(new TextDecoder().decode(out.slice(0, 4))).toBe("%PDF");
  });

  test("renders raw HTML blocks as preformatted text", async () => {
    const md = `Paragraph before.

<div class="callout">
  inline html block
</div>

Paragraph after.
`;
    const out = await renderMarkdownToPdf(md, "Html");
    expect(out.byteLength).toBeGreaterThan(400);
    expect(new TextDecoder().decode(out.slice(0, 4))).toBe("%PDF");
  });

  test("renders nested lists with sub-paragraphs", async () => {
    const md = `- outer item one

  Paragraph nested inside the list item.

  - inner bullet
  - inner bullet two

- outer item two
`;
    const out = await renderMarkdownToPdf(md, "Nested");
    expect(out.byteLength).toBeGreaterThan(400);
  });

  test("renders a markdown table via the catch-all block path", async () => {
    // marked emits `table` tokens; the renderer doesn't special-case them,
    // so this exercises the hasTextField fallback that emits the raw text.
    const md = `| col a | col b |
|-------|-------|
| one   | two   |
| three | four  |
`;
    const out = await renderMarkdownToPdf(md, "Table");
    expect(out.byteLength).toBeGreaterThan(400);
    expect(new TextDecoder().decode(out.slice(0, 4))).toBe("%PDF");
  });

  test("renders inline links and hard line breaks", async () => {
    // The link branch in flattenInline emits the link text; the br branch
    // emits an inline newline. Both are otherwise dead code paths.
    const md = `See [the docs](https://example.com) for details.\\
A line continued after a hard break.
`;
    const out = await renderMarkdownToPdf(md, "Inline");
    expect(out.byteLength).toBeGreaterThan(400);
  });

  test("renders each markdown sentinel exactly once in decoded PDF text", async () => {
    const heading = "UniqueRegressionHeading";
    const paragraph = "SentinelParagraphForRlf83Regression";
    const md = `# ${heading}\n\n${paragraph}\n`;
    const out = await renderMarkdownToPdf(md, "Regression");
    const parser = new PDFParse({ data: new Uint8Array(out) });
    const result = await parser.getText();
    const text = result.text;
    expect(text.split(heading).length - 1).toBe(1);
    expect(text.split(paragraph).length - 1).toBe(1);
  });

  test("paginates long code blocks across pages", async () => {
    const longCode = `\`\`\`\n${"line\n".repeat(200)}\`\`\`\n`;
    const out = await renderMarkdownToPdf(longCode, "Long");
    const haystack = new TextDecoder("latin1").decode(out);
    // pdfkit emits "/Type /Page" for each page in the catalog; assert more
    // than one is present to confirm pagination actually happened.
    const pageMatches = haystack.match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageMatches.length).toBeGreaterThan(1);
  });

  // --- Bug: non-WinAnsi glyphs (box-drawing / arrows) render as "% %" / "!'"
  // garbage because pdfkit's built-in fonts only encode WinAnsi. The renderer
  // must transliterate them to ASCII look-alikes. The "→" arrow decodes to
  // "!'" today and the "├──" branch to "% %".
  describe("unicode in code blocks is transliterated to ASCII", () => {
    const md = "```\nA → B\n├── child\n```\n";

    test("fix_case: an arrow renders as '->' and no box-drawing glyph survives", async () => {
      const text = await extractText(await renderMarkdownToPdf(md, "Unicode"));
      expect(text).toContain("A -> B");
      expect(text).not.toContain("├");
      // For all-mappable input neither the mojibake "%" nor a "?" fallback appears.
      expect(text).not.toContain("%");
      expect(text).not.toContain("?");
    });

    test("bug_case (regression guard): arrow no longer decodes to mojibake", async () => {
      const text = await extractText(await renderMarkdownToPdf(md, "Unicode"));
      // Pre-fix the line read "A !' B"; flipped to guard the garbage never returns.
      expect(text).not.toContain("A !");
    });
  });

  // --- Bug: inline `code` was emitted at a smaller font size than the body
  // text inside the same pdfkit `continued` run, so it sat on a raised
  // baseline ("different line height"). All runs on one line must share a
  // single baseline.
  describe("inline code shares the body text baseline", () => {
    // Short enough to stay on one line so every run shares a baseline y.
    const md = "Word `code` tail words on one short line here.\n";

    test("fix_case: inline code sits within ~1pt of the body baseline", async () => {
      const runs = textRuns(await renderMarkdownToPdf(md, "Inline"));
      // Sanity: the inline code really is styled as a distinct (mono) font.
      const monoRuns = runs.filter((r) => r.font !== runs[0]!.font);
      expect(monoRuns.length).toBeGreaterThan(0);
      // Pre-fix the 9pt mono run floated ~1.9pt above the 10.5pt body. With a
      // shared font size the only residual offset is the Courier↔Helvetica
      // ascender difference (~0.9pt) — visually one line. Threshold sits
      // between the two so a re-shrink of inline code fails this.
      const ys = runs.map((r) => r.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.5);
    });

    test("bug_case (regression guard): inline code is not shrunk below body size", async () => {
      const runs = textRuns(await renderMarkdownToPdf(md, "Inline"));
      const bodySize = Math.max(...runs.map((r) => r.size));
      // Pre-fix the mono run was 9pt vs 10.5pt body; flipped to require every
      // run share one size so baselines stay aligned.
      expect(runs.every((r) => r.size === bodySize)).toBe(true);
    });
  });

  // --- Bug RLF-225: in a *loose* list (blank lines between items) a list
  // item's children are block tokens (paragraph, nested list), so the inline
  // path never fires. renderListItem then ran its empty-item cursor-reset
  // filler (`doc.y = startY`) AFTER the blocks had already flowed down the
  // page, snapping the cursor back to the marker line. The next item then drew
  // on top of the prior item's text. The cursor must only descend.
  describe("loose lists do not overlap text", () => {
    const md = "- outer\n\n  Para inside.\n\n  - inner\n\n- next\n";

    test("bug_case: every baseline descends — no run drawn above earlier content", async () => {
      const runs = textRuns(await renderMarkdownToPdf(md, "Loose"));
      // Sanity: the document actually produced the runs we reason about.
      expect(runs.length).toBeGreaterThan(4);
      // Pre-fix the "next" item snapped ~58pt back up the page and overdrew
      // "outer"/"Para inside.". A tiny tolerance absorbs the Courier↔Helvetica
      // baseline jitter between fragments sharing a visual line.
      expect(maxBacktrack(runs)).toBeLessThan(3);
    });

    test("fix_case: each item's text appears exactly once with nothing lost", async () => {
      const out = await renderMarkdownToPdf(md, "Loose");
      const text = await extractText(out);
      for (const fragment of ["outer", "Para inside.", "inner", "next"]) {
        expect(text.split(fragment).length - 1).toBe(1);
      }
      // And the overlay invariant holds on the same document.
      expect(maxBacktrack(textRuns(out))).toBeLessThan(3);
    });

    test("a genuinely empty list item (bare marker) renders without throwing", async () => {
      const out = await renderMarkdownToPdf("- \n- after\n", "EmptyItem");
      expect(out.byteLength).toBeGreaterThan(200);
      expect(new TextDecoder().decode(out.slice(0, 4))).toBe("%PDF");
    });
  });

  // --- Bug RLF-243: a list item whose inline content mixes several inline
  // `code` spans with prose, in the narrowed list column, wraps across lines.
  // pdfkit's `continued`-text wrapping drops/overlays the tail of a non-final
  // fragment that has to wrap internally, so a whole run of words got drawn on
  // top of earlier words ("text overlay other text"). The same prose as a
  // full-width paragraph wraps cleanly, so inline layout must not rely on
  // pdfkit's continued wrapping.
  describe("inline code in list items does not overlay other text", () => {
    const md = `- \`packages/core/src/openspec/phase.ts\` — add a pure helper
  \`phasePipeline(phase: OpenSpecPhase): PhaseSegment[]\` that returns the
  ordered segment list with per-segment status (\`done\` | \`current\` |
  \`pending\`). Keeping the helper in core (not in the UI) makes it
  unit-testable without React/Ink.
`;

    test("bug_case: no two fragments on a shared baseline overlap horizontally", async () => {
      const runs = textRunsX(await renderMarkdownToPdf(md, "Overlay"));
      // Sanity: the document really produced the mixed-font runs we reason about.
      expect(runs.length).toBeGreaterThan(8);
      // Pre-fix the wrapped prose run was overdrawn ~189pt back onto the inline
      // code fragments. A small tolerance absorbs sub-pixel width jitter.
      expect(maxHorizontalOverlap(runs)).toBeLessThan(2);
    });

    test("fix_case: the wrapped prose survives intact and in reading order", async () => {
      const out = await renderMarkdownToPdf(md, "Overlay");
      const text = (await extractText(out)).replace(/\s+/g, " ");
      // The exact span that pdfkit's continued wrapping clipped/overlaid.
      expect(text).toContain("returns the ordered segment list with per-segment status");
      expect(text).toContain("Keeping the helper in core");
      // And the geometry stays clean on the same document.
      expect(maxHorizontalOverlap(textRunsX(out))).toBeLessThan(2);
    });

    // A code-block line wider than the box wraps (pdfkit wraps even with
    // lineBreak:false once a width is set), but renderCodeBlock advanced the
    // cursor by a single line height — so the next source line drew on top of
    // the wrapped tail. Each line must reserve its real wrapped height.
    test("bug_case: a wrapped long code line does not overlay the next line", async () => {
      const md =
        "```ts\n" +
        "      actions: assign({ worker: undefined, teardown: undefined, " +
        "currentAssignment: ({ context }) => context.pendingAssignment }),\n" +
        '      target: "routing-after-preempt",\n' +
        "```\n";
      const runs = textRunsX(await renderMarkdownToPdf(md, "Code"));
      expect(maxHorizontalOverlap(runs)).toBeLessThan(2);
      const text = (await extractText(await renderMarkdownToPdf(md, "Code"))).replace(/\s+/g, " ");
      expect(text).toContain("routing-after-preempt");
      expect(text).toContain("pendingAssignment");
    });

    test("the equivalent full-width paragraph also stays overlap-free", async () => {
      const para =
        "`packages/core/src/openspec/phase.ts` — add a pure helper " +
        "`phasePipeline(phase: OpenSpecPhase): PhaseSegment[]` that returns the " +
        "ordered segment list with per-segment status (`done` | `current` | " +
        "`pending`). Keeping the helper in core (not in the UI) makes it " +
        "unit-testable without React/Ink.\n";
      expect(maxHorizontalOverlap(textRunsX(await renderMarkdownToPdf(para, "Para")))).toBeLessThan(
        2,
      );
    });
  });
});
