/**
 * Yield newline-delimited chunks from a byte stream, decoding incrementally.
 * Used by every adapter that consumes a CLI's stdout/stderr.
 */
// Safety valve for a pathological newline-free run: a tool that prints a giant
// single-line blob (e.g. `console.log(JSON.stringify(ast))`) would otherwise
// accumulate unbounded in `buffer` and OOM the process — the buffer only drains
// at "\n". Once a partial line crosses this size, flush it as a chunk so memory
// stays bounded; downstream consumers treat it as a (very long) partial line.
const MAX_PARTIAL_LINE_BYTES = 8 * 1024 * 1024;

export async function* streamLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      yield line;
    }

    if (buffer.length > MAX_PARTIAL_LINE_BYTES) {
      yield buffer;
      buffer = "";
    }
  }

  if (buffer.trim()) {
    yield buffer;
  }
}
