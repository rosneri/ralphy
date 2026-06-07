import { describe, expect, test } from "bun:test";
import { getPrChecksStatus, fetchFailedRunLogs } from "../agent/ci";
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
      failedCheckNames: [],
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
      failedCheckNames: [],
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
    expect(status.failedCheckNames.sort()).toEqual(["build", "lint", "test"]);
  });

  test('"fail" extracts check names from failing checks', async () => {
    const { runner } = makeRunner({
      "gh pr checks": {
        stdout: JSON.stringify([
          {
            name: "unit-tests",
            bucket: "fail",
            link: "https://github.com/o/r/actions/runs/1/job/1",
          },
          {
            name: "integration",
            bucket: "fail",
            link: "https://github.com/o/r/actions/runs/2/job/2",
          },
          { name: "deploy", bucket: "pass" },
        ]),
      },
    });
    const status = await getPrChecksStatus("123", runner, "/wt");
    expect(status.bucket).toBe("fail");
    expect(status.failedCheckNames.sort()).toEqual(["integration", "unit-tests"]);
  });
});

describe("getPrChecksStatus ignoreCiChecks", () => {
  test("ignored check is excluded — failing check treated as pass", async () => {
    const { runner } = makeRunner({
      "gh pr checks": {
        stdout: JSON.stringify([
          { name: "Vercel", bucket: "fail", link: "https://github.com/o/r/actions/runs/1/job/1" },
          { name: "test", bucket: "pass" },
        ]),
      },
    });
    const status = await getPrChecksStatus("123", runner, "/wt", undefined, ["Vercel"]);
    expect(status).toEqual({ bucket: "pass", failedRunIds: [], failedCheckNames: [] });
  });

  test("ignored check matching is case-insensitive", async () => {
    const { runner } = makeRunner({
      "gh pr checks": {
        stdout: JSON.stringify([
          { name: "vercel", bucket: "fail", link: "https://github.com/o/r/actions/runs/1/job/1" },
        ]),
      },
    });
    const status = await getPrChecksStatus("123", runner, "/wt", undefined, ["VERCEL"]);
    expect(status).toEqual({ bucket: "pass", failedRunIds: [], failedCheckNames: [] });
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

  test('returns "pass" when gh reports no checks (repo has no CI workflows)', async () => {
    const runner: CmdRunner = {
      run: async () => {
        const err = new Error(
          "`gh pr checks 139` exited 1: no checks reported on the 'ralph/cod-81' branch",
        ) as Error & { stderr?: string };
        err.stderr = "no checks reported on the 'ralph/cod-81' branch\n";
        throw err;
      },
    };
    const status = await getPrChecksStatus("139", runner, "/wt");
    expect(status).toEqual({ bucket: "pass", failedRunIds: [], failedCheckNames: [] });
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
