import { describe, expect, test } from "bun:test";
import { PollContext } from "../agent/poll-context";
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
});
