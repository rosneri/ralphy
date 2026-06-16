import { describe, expect, test } from "bun:test";
import { streamLines } from "../agents/stream";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("streamLines", () => {
  test("yields newline-delimited lines, joining across chunk boundaries", async () => {
    const out: string[] = [];
    for await (const line of streamLines(streamFrom(["a\nb", "c\nd\n", "e"]))) out.push(line);
    expect(out).toEqual(["a", "bc", "d", "e"]);
  });

  test("flushes a pathological newline-free stream instead of buffering unbounded", async () => {
    // A tool dumping a giant single-line blob (e.g. JSON.stringify(ast)) used to
    // accumulate every chunk into one string until OOM. 40 MB, zero newlines.
    const oneMb = "x".repeat(1024 * 1024);
    const chunks = Array.from({ length: 40 }, () => oneMb);

    let yields = 0;
    let maxLen = 0;
    let totalLen = 0;
    for await (const line of streamLines(streamFrom(chunks))) {
      yields++;
      maxLen = Math.max(maxLen, line.length);
      totalLen += line.length;
    }

    // Without the cap this is a single 40 MB yield; with it, multiple bounded
    // flushes that never let the buffer grow without limit — and no data lost.
    expect(yields).toBeGreaterThan(1);
    expect(maxLen).toBeLessThanOrEqual(9 * 1024 * 1024);
    expect(totalLen).toBe(40 * 1024 * 1024);
  });
});
