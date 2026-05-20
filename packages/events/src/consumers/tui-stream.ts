import type { Bus } from "../bus";

export interface TuiSink {
  write(line: string): void;
}

/**
 * Shadow-mode subscriber that mirrors the legacy onLog(text, color)
 * formatting into a sink. Used in tests for byte-for-byte diff against
 * Stage 0 goldens; production code still goes through the Ink renderer.
 */
export function subscribeTuiStream(bus: Bus, sink: TuiSink): () => void {
  return bus.on("log", (event) => {
    const line = event.color ? `[${event.color}] ${event.text}` : event.text;
    sink.write(line + "\n");
  });
}

export class BufferSink implements TuiSink {
  private chunks: string[] = [];
  write(line: string): void {
    this.chunks.push(line);
  }
  text(): string {
    return this.chunks.join("");
  }
  lines(): string[] {
    return this.text()
      .split("\n")
      .filter((l) => l.length > 0);
  }
  clear(): void {
    this.chunks = [];
  }
}
