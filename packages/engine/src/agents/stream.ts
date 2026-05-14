/**
 * Yield newline-delimited chunks from a byte stream, decoding incrementally.
 * Used by every adapter that consumes a CLI's stdout/stderr.
 */
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
  }

  if (buffer.trim()) {
    yield buffer;
  }
}
