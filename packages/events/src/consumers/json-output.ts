import type { Bus } from "../bus";
import type { RalphEvent, RalphEventType } from "../types";

export interface JsonSink {
  write(line: string): void;
}

/** Event types `runAgentJson` emits on its JSON stream. */
const JSON_OUTPUT_TYPES: ReadonlySet<RalphEventType> = new Set<RalphEventType>([
  "started",
  "log",
  "poll_start",
  "poll_done",
  "worker_started",
  "worker_exited",
  "worker_phase",
  "worker_output",
  "worker_cmd_start",
  "worker_cmd_end",
  "worker_pr",
  "awaiting_confirmation",
  "stopped",
]);

/**
 * Shadow-mode subscriber that mirrors `runAgentJson`'s wire format
 * (`JSON.stringify({ ts, type, …rest }) + "\n"`) into a sink. Used in
 * tests; production stdout is still produced by `makeEmit`.
 */
export function subscribeJsonOutput(bus: Bus, sink: JsonSink): () => void {
  return bus.on("*", (event: RalphEvent) => {
    if (!JSON_OUTPUT_TYPES.has(event.type)) return;
    sink.write(JSON.stringify(event) + "\n");
  });
}

export class JsonBufferSink implements JsonSink {
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
