import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "@ralphy/events";
import type { RalphEvent } from "@ralphy/events";
import { installShutdown, waitForActiveWorkers } from "../shutdown";

interface FakeProc {
  on: (sig: string, h: () => void) => void;
  off: (sig: string, h: () => void) => void;
  exit: (code: number) => void;
  fire: (sig: string) => void;
  exitCodes: number[];
}

function makeProc(): FakeProc {
  const handlers = new Map<string, Set<() => void>>();
  const exitCodes: number[] = [];
  return {
    on: (sig, h) => {
      if (!handlers.has(sig)) handlers.set(sig, new Set());
      handlers.get(sig)!.add(h);
    },
    off: (sig, h) => {
      handlers.get(sig)?.delete(h);
    },
    exit: (code) => {
      exitCodes.push(code);
    },
    fire: (sig) => {
      for (const h of handlers.get(sig) ?? []) h();
    },
    exitCodes,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

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

describe("installShutdown — in-process coverage", () => {
  it("graceful path: stops runtime, runs teardowns, flushes bus, closes log, exit 0", async () => {
    const proc = makeProc();
    const bus = createBus();
    const events: RalphEvent[] = [];
    bus.on("*", (e) => {
      events.push(e);
    });
    let stopCalls = 0;
    let teardownCalls = 0;
    let logClosed = false;
    let flushed = false;

    const busWithFlush = Object.assign(bus, {
      flush: async (): Promise<void> => {
        flushed = true;
      },
    });

    const dispose = installShutdown({
      proc,
      bus: busWithFlush,
      runtime: {
        stop: () => {
          stopCalls++;
        },
        activeFlows: () => [
          {
            flowId: "impl",
            teardown: async () => {
              teardownCalls++;
            },
          },
        ],
      },
      log: {
        close: async () => {
          logClosed = true;
        },
      },
      budgetMs: 200,
    });

    proc.fire("SIGINT");
    await flush();

    expect(stopCalls).toBe(1);
    expect(teardownCalls).toBe(1);
    expect(flushed).toBe(true);
    expect(logClosed).toBe(true);
    expect(proc.exitCodes).toEqual([0]);
    expect(events.map((e) => e.type)).toContain("runtime.shutdown.started");
    expect(events.map((e) => e.type)).toContain("runtime.shutdown.teardown.impl");
    expect(events.map((e) => e.type)).toContain("runtime.shutdown.completed");

    dispose();
  });

  it("second signal forces exit 130", async () => {
    const proc = makeProc();
    const bus = createBus();
    installShutdown({
      proc,
      bus,
      runtime: {
        stop: () => {},
        activeFlows: () => [
          {
            flowId: "x",
            teardown: () => new Promise((r) => setTimeout(r, 1000)),
          },
        ],
      },
      budgetMs: 5000,
    });
    proc.fire("SIGINT");
    proc.fire("SIGINT");
    await flush();
    expect(proc.exitCodes[0]).toBe(130);
  });

  it("teardown rejection is reported via failed teardown event", async () => {
    const proc = makeProc();
    const bus = createBus();
    const events: RalphEvent[] = [];
    bus.on("*", (e) => {
      events.push(e);
    });
    installShutdown({
      proc,
      bus,
      runtime: {
        stop: () => {},
        activeFlows: () => [
          {
            flowId: "boom",
            teardown: async () => {
              throw new Error("nope");
            },
          },
        ],
      },
      budgetMs: 200,
    });
    proc.fire("SIGTERM");
    await flush();
    const fail = events.find((e) => e.type === "runtime.shutdown.teardown.boom") as
      | (RalphEvent & { ok?: boolean; error?: string })
      | undefined;
    expect(fail).toBeDefined();
    expect(fail?.ok).toBe(false);
    expect(fail?.error).toBe("nope");
    expect(proc.exitCodes).toEqual([0]);
  });

  it("bus.flush rejection is swallowed; log.close rejection is swallowed", async () => {
    const proc = makeProc();
    const bus = createBus();
    const busWithFlush = Object.assign(bus, {
      flush: async (): Promise<void> => {
        throw new Error("flush-fail");
      },
    });
    installShutdown({
      proc,
      bus: busWithFlush,
      runtime: {
        stop: () => {},
        activeFlows: () => [],
      },
      log: {
        close: async () => {
          throw new Error("close-fail");
        },
      },
      budgetMs: 200,
    });
    proc.fire("SIGINT");
    await flush();
    expect(proc.exitCodes).toEqual([0]);
  });

  it("teardown that exceeds budgetMs is abandoned and shutdown completes", async () => {
    const proc = makeProc();
    const bus = createBus();
    const events: RalphEvent[] = [];
    bus.on("*", (e) => {
      events.push(e);
    });
    installShutdown({
      proc,
      bus,
      runtime: {
        stop: () => {},
        activeFlows: () => [
          {
            flowId: "slow",
            teardown: () => new Promise((r) => setTimeout(r, 5000)),
          },
        ],
      },
      budgetMs: 30,
    });
    proc.fire("SIGINT");
    await new Promise((r) => setTimeout(r, 100));
    expect(events.map((e) => e.type)).toContain("runtime.shutdown.completed");
    expect(proc.exitCodes).toEqual([0]);
  });

  it("dispose removes handlers", () => {
    const proc = makeProc();
    const bus = createBus();
    const dispose = installShutdown({
      proc,
      bus,
      runtime: { stop: () => {}, activeFlows: () => [] },
      budgetMs: 100,
    });
    dispose();
    proc.fire("SIGINT");
    expect(proc.exitCodes).toEqual([]);
  });
});

describe("waitForActiveWorkers", () => {
  it("resolves immediately when active count is already zero", async () => {
    let stopped = 0;
    await waitForActiveWorkers({
      stop: () => {
        stopped++;
      },
      getActiveCount: () => 0,
    });
    expect(stopped).toBe(1);
  });

  it("warns once after warnAtMs and times out after budgetMs", async () => {
    let warnedWith: number | undefined;
    let timedOutWith: number | undefined;
    let warnCalls = 0;
    await waitForActiveWorkers({
      stop: () => {},
      getActiveCount: () => 3,
      budgetMs: 250,
      warnAtMs: 120,
      onWarn: (n) => {
        warnedWith = n;
        warnCalls++;
      },
      onTimeout: (n) => {
        timedOutWith = n;
      },
    });
    expect(warnedWith).toBe(3);
    expect(warnCalls).toBe(1);
    expect(timedOutWith).toBe(3);
  });

  it("resolves when active drops to zero before budget", async () => {
    let count = 2;
    const t0 = Date.now();
    setTimeout(() => {
      count = 0;
    }, 80);
    let timedOut = false;
    await waitForActiveWorkers({
      stop: () => {},
      getActiveCount: () => count,
      budgetMs: 2000,
      warnAtMs: 5000,
      onTimeout: () => {
        timedOut = true;
      },
    });
    expect(timedOut).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
