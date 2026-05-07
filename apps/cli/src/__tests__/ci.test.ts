import { describe, expect, test } from "bun:test";
import {
  fixCiUntilGreen,
  getPrChecksStatus,
  fetchFailedRunLogs,
  type CiFixDeps,
  type CiStatus,
} from "../agent/ci";
import type { CmdRunner } from "../agent/pr";

interface ResponseSpec {
  stdout?: string;
  stderr?: string;
  throw?: boolean;
}

function makeRunner(responses: Record<string, ResponseSpec>): {
  runner: CmdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      const joined = cmd.join(" ");
      for (const [key, r] of Object.entries(responses)) {
        if (joined.startsWith(key)) {
          if (r.throw) throw new Error("cmd failed");
          return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        }
      }
      return { stdout: "", stderr: "" };
    },
  };
  return { runner, calls };
}

describe("getPrChecksStatus", () => {
  test('"pending" if any check is still running', async () => {
    const { runner } = makeRunner({
      "gh pr checks": {
        stdout: JSON.stringify([
          { name: "test", bucket: "pass" },
          { name: "build", bucket: "pending" },
        ]),
      },
    });
    expect(await getPrChecksStatus("123", runner, "/wt")).toEqual({
      bucket: "pending",
      failedRunIds: [],
    });
  });

  test('"pass" when all checks pass (and "skipping" is ignored)', async () => {
    const { runner } = makeRunner({
      "gh pr checks": {
        stdout: JSON.stringify([
          { name: "test", bucket: "pass" },
          { name: "skipped", bucket: "skipping" },
        ]),
      },
    });
    expect(await getPrChecksStatus("123", runner, "/wt")).toEqual({
      bucket: "pass",
      failedRunIds: [],
    });
  });

  test('"fail" extracts unique run IDs from check links', async () => {
    const { runner } = makeRunner({
      "gh pr checks": {
        stdout: JSON.stringify([
          {
            name: "test",
            bucket: "fail",
            link: "https://github.com/o/r/actions/runs/12345/job/9876",
          },
          {
            name: "build",
            bucket: "cancel",
            link: "https://github.com/o/r/actions/runs/12345/job/9999",
          },
          {
            name: "lint",
            bucket: "fail",
            link: "https://github.com/o/r/actions/runs/55555/job/1",
          },
        ]),
      },
    });
    const status = await getPrChecksStatus("123", runner, "/wt");
    expect(status.bucket).toBe("fail");
    expect(status.failedRunIds.sort()).toEqual(["12345", "55555"]);
  });
});

describe("getPrChecksStatus retry on transient failure", () => {
  test("retries on HTTP 504 and eventually succeeds", async () => {
    let calls = 0;
    const runner: CmdRunner = {
      run: async () => {
        calls += 1;
        if (calls < 3) {
          const err = new Error(
            "`gh pr checks 123` exited 1: HTTP 504: 504 Gateway Timeout",
          ) as Error & { stderr?: string; code?: number };
          err.stderr = "HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)\n";
          err.code = 1;
          throw err;
        }
        return { stdout: JSON.stringify([{ name: "t", bucket: "pass" }]), stderr: "" };
      },
    };
    // Stub setTimeout via a fake delay through onTransientRetry side-effect:
    // we can't intercept the internal sleep, so just rely on the test
    // running fast — three retries with 5/15/45s would time out the test
    // suite. Instead, patch global setTimeout for this case.
    const realSetTimeout = globalThis.setTimeout;
    const g = globalThis as { setTimeout: typeof setTimeout };
    g.setTimeout = ((fn: () => void): ReturnType<typeof setTimeout> =>
      realSetTimeout(fn, 0)) as typeof setTimeout;
    try {
      const retries: number[] = [];
      const status = await getPrChecksStatus("123", runner, "/wt", (n) => {
        retries.push(n);
      });
      expect(status.bucket).toBe("pass");
      expect(calls).toBe(3);
      expect(retries).toEqual([1, 2]);
    } finally {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout = realSetTimeout;
    }
  });

  test("does not retry on non-transient failure", async () => {
    let calls = 0;
    const runner: CmdRunner = {
      run: async () => {
        calls += 1;
        const err = new Error("`gh pr checks 123` exited 1: not authenticated") as Error & {
          stderr?: string;
        };
        err.stderr = "gh: not authenticated\n";
        throw err;
      },
    };
    await expect(getPrChecksStatus("123", runner, "/wt")).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("fetchFailedRunLogs", () => {
  test("concatenates per-run logs and truncates long output", async () => {
    const longLog = "x".repeat(5000);
    const { runner } = makeRunner({
      "gh run view 1 --log-failed": { stdout: "short log line\n" },
      "gh run view 2 --log-failed": { stdout: longLog },
    });
    const out = await fetchFailedRunLogs(["1", "2"], runner, "/wt", 100);
    expect(out).toContain("--- run 1 ---");
    expect(out).toContain("short log line");
    expect(out).toContain("--- run 2 ---");
    expect(out).toContain("…[truncated");
    expect(out.length).toBeLessThan(5000);
  });

  test("captures fetch failures inline without throwing", async () => {
    const { runner } = makeRunner({
      "gh run view 9 --log-failed": { throw: true },
    });
    const out = await fetchFailedRunLogs(["9"], runner, "/wt");
    expect(out).toContain("(failed to fetch logs:");
  });
});

interface FixHarness {
  deps: CiFixDeps;
  log: { text: string; color?: string }[];
  taskCalls: string[];
  pushCalls: number;
  setStatuses: (xs: CiStatus[]) => void;
}

function makeFixHarness(): FixHarness {
  let queue: CiStatus[] = [];
  const log: { text: string; color?: string }[] = [];
  const taskCalls: string[] = [];
  let pushCalls = 0;
  const deps: CiFixDeps = {
    getStatus: async () => queue.shift() ?? { bucket: "pending", failedRunIds: [] },
    getFailedLogs: async (ids) => `logs for ${ids.join(",")}`,
    runTaskWithSteering: async (s) => {
      taskCalls.push(s);
      return 0;
    },
    pushBranch: async () => {
      pushCalls++;
    },
    log: (t, c) => log.push(c !== undefined ? { text: t, color: c } : { text: t }),
    sleep: () => Promise.resolve(),
  };
  return {
    deps,
    log,
    taskCalls,
    get pushCalls() {
      return pushCalls;
    },
    setStatuses: (xs) => {
      queue = xs;
    },
  } as FixHarness;
}

describe("fixCiUntilGreen", () => {
  test("returns success immediately when checks already pass", async () => {
    const h = makeFixHarness();
    h.setStatuses([{ bucket: "pass", failedRunIds: [] }]);
    const r = await fixCiUntilGreen(h.deps, { maxAttempts: 3, pollIntervalSeconds: 0 });
    expect(r).toEqual({ success: true, attempts: 0 });
    expect(h.taskCalls).toHaveLength(0);
  });

  test("re-runs task on failure, then returns success when subsequent run is green", async () => {
    const h = makeFixHarness();
    h.setStatuses([
      { bucket: "fail", failedRunIds: ["1"] },
      { bucket: "pass", failedRunIds: [] },
    ]);
    const r = await fixCiUntilGreen(h.deps, { maxAttempts: 3, pollIntervalSeconds: 0 });
    expect(r.success).toBe(true);
    expect(h.taskCalls).toHaveLength(1);
    expect(h.taskCalls[0]).toContain("CI is failing");
    expect(h.taskCalls[0]).toContain("logs for 1");
    expect(h.pushCalls).toBe(1);
  });

  test("polls through pending statuses until pass", async () => {
    const h = makeFixHarness();
    h.setStatuses([
      { bucket: "pending", failedRunIds: [] },
      { bucket: "pending", failedRunIds: [] },
      { bucket: "pass", failedRunIds: [] },
    ]);
    const r = await fixCiUntilGreen(h.deps, { maxAttempts: 3, pollIntervalSeconds: 0 });
    expect(r.success).toBe(true);
  });

  test("gives up after maxAttempts of repeated failure", async () => {
    const h = makeFixHarness();
    // Always fail.
    h.deps.getStatus = async () => ({ bucket: "fail", failedRunIds: ["1"] });
    const r = await fixCiUntilGreen(h.deps, { maxAttempts: 2, pollIntervalSeconds: 0 });
    expect(r).toEqual({ success: false, attempts: 2, reason: "max-attempts" });
    expect(h.taskCalls).toHaveLength(2);
  });

  test("bails when pushBranch throws", async () => {
    const h = makeFixHarness();
    h.setStatuses([{ bucket: "fail", failedRunIds: ["1"] }]);
    h.deps.pushBranch = async () => {
      throw new Error("permission denied");
    };
    const r = await fixCiUntilGreen(h.deps, { maxAttempts: 3, pollIntervalSeconds: 0 });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("push-failed");
  });

  test("respects cancelled() and exits without further work", async () => {
    const h = makeFixHarness();
    h.deps.cancelled = () => true;
    const r = await fixCiUntilGreen(h.deps, { maxAttempts: 3, pollIntervalSeconds: 0 });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("cancelled");
  });
});
