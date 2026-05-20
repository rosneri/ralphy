import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "../bus";
import { subscribeFileLogger } from "../consumers/file-logger";
import { subscribePostHog } from "../consumers/posthog";
import { BufferSink, subscribeTuiStream } from "../consumers/tui-stream";
import { JsonBufferSink, subscribeJsonOutput } from "../consumers/json-output";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "events-perf-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("perf", () => {
  test("1000 mixed events through 4 consumers in < 50ms", async () => {
    const bus = createBus();
    const offFile = subscribeFileLogger(bus, { rootDir: dir });
    const offPh = subscribePostHog(bus, () => {});
    const tui = new BufferSink();
    const offTui = subscribeTuiStream(bus, tui);
    const jsonSink = new JsonBufferSink();
    const offJson = subscribeJsonOutput(bus, jsonSink);

    // Warm up the FS so the housekeeping pass doesn't pollute the loop.
    await Bun.sleep(20);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      if (i % 3 === 0) {
        bus.emit({ type: "log", text: `t${i}`, color: "cyan" });
      } else if (i % 3 === 1) {
        bus.emit({ type: "poll_start" });
      } else {
        bus.emit({ type: "command_run", subcommand: "agent" });
      }
    }
    const elapsed = performance.now() - start;
    offFile();
    offPh();
    offTui();
    offJson();
    expect(elapsed).toBeLessThan(50);
  });
});
