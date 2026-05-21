import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "rlf95-shutdown-"));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(join(import.meta.dir, ".shutdown-fixture.ts"), { force: true });
});

const FIXTURE = `
import { installShutdown } from "../shutdown";
import { createBus } from "@ralphy/events";

const logFile = process.env.RALPH_LOG_FILE!;
const bus = createBus();
const writer = Bun.file(logFile).writer();
const unsub = bus.on("*", (event) => {
  writer.write(JSON.stringify(event) + "\\n");
  writer.flush();
});

const runtime = {
  stop: () => {},
  activeFlows: () => [
    {
      flowId: "implement",
      teardown: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
    },
  ],
};

installShutdown({
  runtime,
  bus,
  budgetMs: 5000,
  log: {
    close: async () => {
      unsub();
      writer.end();
    },
  },
});

console.log("READY");
setInterval(() => {}, 1000);
`;

describe("runtime/shutdown", () => {
  it("graceful SIGINT shutdown emits the full trace and exits 0", async () => {
    // Fixture must live inside the workspace so bun can resolve
    // `@ralphy/events`. We write it next to this test file and
    // clean it up after.
    const fixturePath = join(import.meta.dir, ".shutdown-fixture.ts");
    const logFile = join(tmp, "events.jsonl");
    await Bun.write(fixturePath, FIXTURE);

    const child = Bun.spawn(["bun", fixturePath], {
      env: { ...process.env, RALPH_LOG_FILE: logFile },
      stdout: "pipe",
      stderr: "inherit",
    });

    // Wait for READY before sending SIGINT.
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (!buffered.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value);
    }
    reader.releaseLock();

    child.kill("SIGINT");
    const code = await child.exited;
    expect(code).toBe(0);

    const raw = await Bun.file(logFile).text();
    const lines = raw.split("\n").filter((l) => l.length > 0);
    // Each line must be valid JSON.
    const events = lines.map((l) => JSON.parse(l) as { type: string });
    const types = events.map((e) => e.type);

    expect(types).toContain("runtime.shutdown.started");
    expect(types).toContain("runtime.shutdown.teardown.implement");
    expect(types).toContain("runtime.shutdown.completed");

    // Ordering: started → teardown → completed.
    const iStarted = types.indexOf("runtime.shutdown.started");
    const iTeardown = types.indexOf("runtime.shutdown.teardown.implement");
    const iCompleted = types.indexOf("runtime.shutdown.completed");
    expect(iStarted).toBeLessThan(iTeardown);
    expect(iTeardown).toBeLessThan(iCompleted);
  }, 20_000);
});
