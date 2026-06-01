import { afterEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveRetroOutputPath, retroDir, runRetrospective } from "../retro";
import type { RetroContext, RetroRunEngineOptions } from "../types";

// Unique per-process identifier so the report lands in a slot of the real
// ~/.ralph/retro dir that no other run touches; cleaned up after each test.
const ID = `RETROTEST-${process.pid}`;
const DATE = "2026-06-01";

function ctx(overrides: Partial<RetroContext> = {}): RetroContext {
  return {
    identifier: ID,
    changeName: "retro-test-change",
    cwd: "/work/tree",
    engine: "claude",
    model: "opus",
    exitCode: 0,
    prUrl: null,
    date: DATE,
    ticketDigest: "Title: t\n\nbody",
    paths: {
      changeDir: "/c",
      stateFilePath: "/s/.ralph-state.json",
      logFile: null,
      jsonLogFile: null,
      agentStateFile: null,
    },
    ...overrides,
  };
}

afterEach(async () => {
  // Remove any versioned report files this test produced.
  for (let n = 1; n < 6; n++) {
    const name = n === 1 ? `${ID}-${DATE}.md` : `${ID}-${DATE}-${n}.md`;
    await rm(join(retroDir(), name), { force: true });
  }
});

describe("runRetrospective", () => {
  it("resolves the output path, runs the engine and verifies the written file", async () => {
    const calls: RetroRunEngineOptions[] = [];
    const result = await runRetrospective(ctx(), {
      seen: new Set(),
      log: () => {},
      runEngine: async (opts) => {
        calls.push(opts);
        opts.onOutput?.("engine line");
        // The agent would Write the report; simulate by creating the file the
        // prompt instructed it to write.
        const expected = await resolveRetroOutputPath(ID, DATE);
        await Bun.write(expected, "# report");
        return { exitCode: 0 };
      },
    });

    expect(result.written).toBe(true);
    expect(result.outputPath).toBe(join(retroDir(), `${ID}-${DATE}.md`));
    expect(result.disposition).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.engine).toBe("claude");
    expect(calls[0]?.prompt).toContain(result.outputPath!);
    expect(await Bun.file(result.outputPath!).exists()).toBe(true);
  });

  it("reports written:false when the engine wrote no file", async () => {
    const result = await runRetrospective(ctx(), {
      seen: new Set(),
      log: () => {},
      runEngine: async () => ({ exitCode: 0 }),
    });
    expect(result.written).toBe(false);
    expect(result.outputPath).toBe(join(retroDir(), `${ID}-${DATE}.md`));
  });

  it("skips a duplicate disposition/date for the same identifier", async () => {
    const seen = new Set<string>();
    let runs = 0;
    const deps = {
      seen,
      log: () => {},
      runEngine: async () => {
        runs++;
        return { exitCode: 0 };
      },
    };
    await runRetrospective(ctx(), deps);
    const second = await runRetrospective(ctx(), deps);

    expect(runs).toBe(1);
    expect(second.skipped).toBe("duplicate");
    expect(second.written).toBe(false);
  });

  it("isolates a thrown engine error: returns written:false and never throws", async () => {
    const result = await runRetrospective(ctx(), {
      seen: new Set(),
      log: () => {},
      runEngine: async () => {
        throw new Error("engine exploded");
      },
    });
    expect(result.written).toBe(false);
    expect(result.disposition).toBe("done");
  });
});
