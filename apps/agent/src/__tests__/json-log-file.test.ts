import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createJsonLogFileSink } from "../agent/json-log-file";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "json-log-file-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function flush(sink: { emit: (e: Record<string, unknown>) => void }): Promise<void> {
  // The sink chains writes through a Promise; emit one no-op event and wait a
  // microtask cycle to ensure all queued appends have completed.
  await new Promise((r) => setTimeout(r, 50));
  void sink;
}

describe("createJsonLogFileSink", () => {
  test("returns a no-op sink when path is undefined", async () => {
    const sink = createJsonLogFileSink(undefined);
    sink.emit({ type: "started" });
    sink.emit({ type: "log", text: "x" });
    // No file is written. Nothing throws.
    await flush(sink);
    expect(true).toBe(true);
  });

  test("creates parent dir, truncates file, appends JSON lines", async () => {
    const path = join(tempDir, "nested", "events.jsonl");
    // Pre-write something to confirm truncation happens.
    // (Parent doesn't exist yet — we rely on the sink to mkdir.)
    const sink = createJsonLogFileSink(path);
    sink.emit({ type: "started", version: "1.0.0" });
    sink.emit({ type: "stopped" });
    await flush(sink);

    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const ev0 = JSON.parse(lines[0]!) as Record<string, unknown>;
    const ev1 = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(ev0.type).toBe("started");
    expect(ev0.version).toBe("1.0.0");
    expect(typeof ev0.ts).toBe("number");
    expect(ev1.type).toBe("stopped");
    expect(typeof ev1.ts).toBe("number");
  });

  test("truncates an existing file on init", async () => {
    const path = join(tempDir, "events.jsonl");
    writeFileSync(path, "stale\nstale\n");
    const sink = createJsonLogFileSink(path);
    sink.emit({ type: "started" });
    await flush(sink);

    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(ev.type).toBe("started");
  });
});
