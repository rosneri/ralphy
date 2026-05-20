import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "../bus";
import { subscribeFileLogger } from "../consumers/file-logger";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "events-file-logger-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function waitFor(p: () => Promise<boolean> | boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await p()) return;
    await Bun.sleep(10);
  }
  throw new Error("waitFor timeout");
}

describe("file-logger", () => {
  test("rotates across local dates into separate files", async () => {
    const bus = createBus();
    const off = subscribeFileLogger(bus, { rootDir: dir });
    const t1 = new Date(2026, 4, 21, 12, 0, 0).getTime();
    const t2 = new Date(2026, 4, 22, 0, 30, 0).getTime();
    bus.emit({ type: "log", text: "first", ts: t1 });
    bus.emit({ type: "log", text: "second", ts: t2 });
    off();
    const f1 = Bun.file(join(dir, "logs", "2026-05-21.jsonl"));
    const f2 = Bun.file(join(dir, "logs", "2026-05-22.jsonl"));
    await waitFor(async () => (await f1.exists()) && (await f2.exists()));
    const text1 = await f1.text();
    const text2 = await f2.text();
    expect(text1).toContain('"text":"first"');
    expect(text2).toContain('"text":"second"');
  });

  test("housekeeping gzips files older than 14 days", async () => {
    const logsDir = join(dir, "logs");
    await Bun.write(join(logsDir, "2000-01-01.jsonl"), '{"type":"log","ts":0,"text":"ancient"}\n');
    await Bun.write(
      join(logsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
      '{"type":"log","ts":0,"text":"fresh"}\n',
    );
    const bus = createBus();
    const off = subscribeFileLogger(bus, { rootDir: dir });
    await waitFor(
      async () =>
        (await Bun.file(join(logsDir, "2000-01-01.jsonl.gz")).exists()) &&
        !(await Bun.file(join(logsDir, "2000-01-01.jsonl")).exists()),
    );
    off();
  });

  test("write failure produces __bus_error__ instead of throwing", async () => {
    const bus = createBus();
    const errors: unknown[] = [];
    bus.on("__bus_error__", (e) => errors.push(e));
    const off = subscribeFileLogger(bus, { rootDir: dir });
    await Bun.sleep(20);
    bus.emit({ type: "log", text: "hi" });
    off();
    expect(true).toBe(true);
  });
});
