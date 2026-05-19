import { describe, expect, test } from "bun:test";
import { renderMarkdownToPdf } from "../agent/linear-sync/render-pdf";

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

  test("paginates long code blocks across pages", async () => {
    const longCode = `\`\`\`\n${"line\n".repeat(200)}\`\`\`\n`;
    const out = await renderMarkdownToPdf(longCode, "Long");
    const haystack = new TextDecoder("latin1").decode(out);
    // pdfkit emits "/Type /Page" for each page in the catalog; assert more
    // than one is present to confirm pagination actually happened.
    const pageMatches = haystack.match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageMatches.length).toBeGreaterThan(1);
  });
});
