import { describe, expect, test } from "bun:test";
import { applyWorkerMemoryCap, WORKER_MEM_MAX_ENV } from "../memory-cap";

// A runaway worker descendant (e.g. a bare `bun test` over the whole monorepo,
// or a buggy script) can grow to many GB. With every worker sharing the
// coordinator's single cgroup, one such process OOM-kills the whole fleet.
// Wrapping each worker in its own memory-capped systemd scope contains the
// blast: the kernel OOM-killer kills only that worker's scope.
const CMD = ["bun", ".ralph/bin/shell.js", "loop", "task", "--name", "rlf-1"];

describe("applyWorkerMemoryCap", () => {
  test("passes the command through unchanged when the cap env is unset", () => {
    expect(applyWorkerMemoryCap(CMD, {}, true)).toEqual(CMD);
  });

  test("passes through unchanged when the env is set but systemd-run is unavailable", () => {
    expect(applyWorkerMemoryCap(CMD, { [WORKER_MEM_MAX_ENV]: "6G" }, false)).toEqual(CMD);
  });

  test("wraps the command in a memory-capped systemd scope when configured", () => {
    const out = applyWorkerMemoryCap(CMD, { [WORKER_MEM_MAX_ENV]: "6G" }, true);
    expect(out.slice(0, out.indexOf("--") + 1)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "-p",
      "MemoryMax=6G",
      "-p",
      "MemorySwapMax=0",
      "--",
    ]);
    // the original command is preserved verbatim after the `--` separator
    expect(out.slice(out.indexOf("--") + 1)).toEqual(CMD);
  });

  test("ignores a blank/whitespace cap value", () => {
    expect(applyWorkerMemoryCap(CMD, { [WORKER_MEM_MAX_ENV]: "   " }, true)).toEqual(CMD);
  });

  test("does not mutate the input command array", () => {
    const original = [...CMD];
    applyWorkerMemoryCap(CMD, { [WORKER_MEM_MAX_ENV]: "4G" }, true);
    expect(CMD).toEqual(original);
  });
});
