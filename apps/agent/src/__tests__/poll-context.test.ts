import { describe, expect, test } from "bun:test";
import { PollContext } from "../shared/capabilities/poll-context";
import type { CmdRunner } from "../agent/pr";

function counterRunner(stdout: string): CmdRunner & { calls: { cmd: string[]; cwd: string }[] } {
  const calls: { cmd: string[]; cwd: string }[] = [];
  return {
    calls,
    run: async (cmd, cwd) => {
      calls.push({ cmd, cwd });
      return { stdout, stderr: "" };
    },
  };
}

describe("PollContext.fetchPrOnce", () => {
  test("two calls with the same url + fields share one invocation", async () => {
    const runner = counterRunner(JSON.stringify({ state: "OPEN", mergeable: "MERGEABLE" }));
    const ctx = new PollContext();
    const url = "https://github.com/o/r/pull/1";
    const [a, b] = await Promise.all([
      ctx.fetchPrOnce(url, ["state", "mergeable"], runner, "."),
      ctx.fetchPrOnce(url, ["state", "mergeable"], runner, "."),
    ]);
    expect(runner.calls).toHaveLength(1);
    expect(a).toEqual({ state: "OPEN", mergeable: "MERGEABLE" });
    expect(b).toEqual(a);
  });

  test("sequential same-key call reuses the cached promise", async () => {
    const runner = counterRunner(JSON.stringify({ state: "OPEN" }));
    const ctx = new PollContext();
    const url = "https://github.com/o/r/pull/2";
    await ctx.fetchPrOnce(url, ["state"], runner, ".");
    await ctx.fetchPrOnce(url, ["state"], runner, ".");
    expect(runner.calls).toHaveLength(1);
  });

  test("fields-order-insensitive — sorted key collapses ['state','mergeable'] and ['mergeable','state']", async () => {
    const runner = counterRunner(JSON.stringify({}));
    const ctx = new PollContext();
    const url = "https://github.com/o/r/pull/3";
    await ctx.fetchPrOnce(url, ["state", "mergeable"], runner, ".");
    await ctx.fetchPrOnce(url, ["mergeable", "state"], runner, ".");
    expect(runner.calls).toHaveLength(1);
  });

  test("a third call with a different field list re-runs", async () => {
    const runner = counterRunner(JSON.stringify({}));
    const ctx = new PollContext();
    const url = "https://github.com/o/r/pull/4";
    await ctx.fetchPrOnce(url, ["state", "mergeable"], runner, ".");
    await ctx.fetchPrOnce(url, ["state", "mergeable"], runner, ".");
    await ctx.fetchPrOnce(url, ["state", "headRefName"], runner, ".");
    expect(runner.calls).toHaveLength(2);
  });

  test("two PollContext instances do not share memos", async () => {
    const runner = counterRunner(JSON.stringify({}));
    const a = new PollContext();
    const b = new PollContext();
    const url = "https://github.com/o/r/pull/5";
    await a.fetchPrOnce(url, ["state"], runner, ".");
    await b.fetchPrOnce(url, ["state"], runner, ".");
    expect(runner.calls).toHaveLength(2);
  });

  test("rejected fetch is dropped from the memo — next call retries", async () => {
    let attempt = 0;
    const calls: { cmd: string[]; cwd: string }[] = [];
    const runner: CmdRunner = {
      run: async (cmd, cwd) => {
        attempt += 1;
        calls.push({ cmd, cwd });
        if (attempt === 1) throw new Error("transient");
        return { stdout: JSON.stringify({ state: "OPEN" }), stderr: "" };
      },
    };
    const ctx = new PollContext();
    const url = "https://github.com/o/r/pull/6";
    await expect(ctx.fetchPrOnce(url, ["state"], runner, ".")).rejects.toThrow("transient");
    const second = await ctx.fetchPrOnce(url, ["state"], runner, ".");
    expect(second).toEqual({ state: "OPEN" });
    expect(calls).toHaveLength(2);
  });

  test("clear() drops cached entries", async () => {
    const runner = counterRunner(JSON.stringify({}));
    const ctx = new PollContext();
    const url = "https://github.com/o/r/pull/7";
    await ctx.fetchPrOnce(url, ["state"], runner, ".");
    ctx.clear();
    await ctx.fetchPrOnce(url, ["state"], runner, ".");
    expect(runner.calls).toHaveLength(2);
  });
});
