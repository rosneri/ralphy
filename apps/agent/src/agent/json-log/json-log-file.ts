import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

interface JsonLogFileSink {
  emit(event: Record<string, unknown>): void;
}

/**
 * Returns a sink that mirrors JSONL events to a file. When `path` is undefined
 * the sink is a no-op. When defined, the parent directory is created and the
 * file is truncated on init; subsequent `emit(...)` calls append one
 * JSON-encoded line per event. All I/O errors are swallowed so logging
 * failures never crash the agent.
 *
 * Writes are serialized through a promise chain so concurrent emits cannot
 * interleave bytes within a single line.
 */
export function createJsonLogFileSink(path: string | undefined): JsonLogFileSink {
  if (!path) return { emit: () => {} };

  let chain: Promise<void> = (async () => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, "");
    } catch {
      /* swallow */
    }
  })();

  return {
    emit(event: Record<string, unknown>): void {
      const line = JSON.stringify({ ts: Date.now(), ...event }) + "\n";
      chain = chain.then(async () => {
        try {
          await appendFile(path, line);
        } catch {
          /* swallow */
        }
      });
    },
  };
}
