import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logJsonEvent, flushJsonLog, initWorkerLog } from "../log";

describe("logJsonEvent", () => {
  let logFile: string;

  beforeEach(async () => {
    logFile = join(tmpdir(), `log-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    await initWorkerLog(logFile);
  });

  afterEach(async () => {
    await Bun.file(logFile)
      .exists()
      .then((exists) => {
        if (exists) return Bun.write(logFile, "");
        return undefined;
      });
  });

  it("serializes concurrent writes so all lines appear in the output file", async () => {
    const COUNT = 50;
    for (let i = 0; i < COUNT; i++) {
      logJsonEvent(logFile, { index: i });
    }
    await flushJsonLog(logFile);

    const content = await Bun.file(logFile).text();
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(COUNT);

    const indices = lines.map((l) => JSON.parse(l).index as number);
    expect(indices.sort((a, b) => a - b)).toEqual(Array.from({ length: COUNT }, (_, i) => i));
  });

  it("includes a ts field on each event", async () => {
    logJsonEvent(logFile, { kind: "test" });
    await flushJsonLog(logFile);

    const content = await Bun.file(logFile).text();
    const event = JSON.parse(content.trim());
    expect(typeof event.ts).toBe("string");
    expect(event.kind).toBe("test");
  });

  it("resets the chain after initWorkerLog truncates the file", async () => {
    logJsonEvent(logFile, { phase: "before" });
    await flushJsonLog(logFile);

    await initWorkerLog(logFile);

    logJsonEvent(logFile, { phase: "after" });
    await flushJsonLog(logFile);

    const content = await Bun.file(logFile).text();
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).phase).toBe("after");
  });
});
