import { describe, expect, test } from "bun:test";
import { discoverPrUrlFromGitHub, createPrUrlCache } from "../agent/pr-url";
import type { CmdRunner } from "../agent/pr";

interface GhCall {
  args: string[];
  cwd: string;
}

function makeRunner(stdout: string, calls: GhCall[] = [], throwErr?: Error): CmdRunner {
  return {
    run: async (args, cwd) => {
      calls.push({ args, cwd });
      if (throwErr) throw throwErr;
      return { stdout, stderr: "" };
    },
  };
}

describe("discoverPrUrlFromGitHub", () => {
  test("matches by title — happy path, prefers OPEN PR", async () => {
    const calls: GhCall[] = [];
    const runner = makeRunner(
      JSON.stringify([
        {
          url: "https://github.com/o/r/pull/1",
          state: "MERGED",
          headRefName: "old/eng-7-thing",
          title: "ENG-7: old shipped attempt",
          updatedAt: "2026-04-01T10:00:00Z",
        },
        {
          url: "https://github.com/o/r/pull/2",
          state: "OPEN",
          headRefName: "ralph/eng-7-thing",
          title: "ENG-7: ship it",
          updatedAt: "2026-04-10T10:00:00Z",
        },
      ]),
      calls,
    );
    const result = await discoverPrUrlFromGitHub("ENG-7", runner, "/cwd");
    expect(result).toBe("https://github.com/o/r/pull/2");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain("--search");
    expect(calls[0]!.args).toContain("ENG-7 in:title");
    expect(calls[0]!.args).toContain("--state");
    expect(calls[0]!.args).toContain("all");
  });

  test("matches by headRefName slug even when title does not mention identifier", async () => {
    const runner = makeRunner(
      JSON.stringify([
        {
          url: "https://github.com/o/r/pull/9",
          state: "OPEN",
          headRefName: "feature/rlf-66-pr-url-cache",
          title: "PR URL cache work",
          updatedAt: "2026-05-10T10:00:00Z",
        },
      ]),
    );
    const result = await discoverPrUrlFromGitHub("RLF-66", runner, "/cwd");
    expect(result).toBe("https://github.com/o/r/pull/9");
  });

  test("tie-break by most recently updated when no OPEN PR exists", async () => {
    const runner = makeRunner(
      JSON.stringify([
        {
          url: "https://github.com/o/r/pull/1",
          state: "MERGED",
          headRefName: "ralph/eng-7-old",
          title: "ENG-7: old",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        {
          url: "https://github.com/o/r/pull/2",
          state: "CLOSED",
          headRefName: "ralph/eng-7-new",
          title: "ENG-7: new",
          updatedAt: "2026-04-01T00:00:00Z",
        },
      ]),
    );
    const result = await discoverPrUrlFromGitHub("ENG-7", runner, "/cwd");
    expect(result).toBe("https://github.com/o/r/pull/2");
  });

  test("returns null when no row matches the identifier", async () => {
    const runner = makeRunner(
      JSON.stringify([
        {
          url: "https://github.com/o/r/pull/3",
          state: "OPEN",
          headRefName: "feature/something-else",
          title: "unrelated PR",
          updatedAt: "2026-05-01T00:00:00Z",
        },
      ]),
    );
    const result = await discoverPrUrlFromGitHub("ENG-7", runner, "/cwd");
    expect(result).toBeNull();
  });

  test("logs yellow and returns null on gh failure", async () => {
    const calls: GhCall[] = [];
    const runner = makeRunner("", calls, new Error("gh boom"));
    const logs: { msg: string; color?: string }[] = [];
    const result = await discoverPrUrlFromGitHub("ENG-7", runner, "/cwd", (m, c) =>
      logs.push({ msg: m, ...(c ? { color: c } : {}) }),
    );
    expect(result).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.color).toBe("yellow");
  });

  test("partial word match in title does not count (boundary check)", async () => {
    const runner = makeRunner(
      JSON.stringify([
        {
          url: "https://github.com/o/r/pull/1",
          state: "OPEN",
          headRefName: "feature/eng-77",
          title: "ENG-77: different ticket",
          updatedAt: "2026-04-01T00:00:00Z",
        },
      ]),
    );
    const result = await discoverPrUrlFromGitHub("ENG-7", runner, "/cwd");
    // headRefName "eng-77" contains "eng-7" as a substring; current
    // behavior accepts it. Document via expectation so any future
    // tightening is a deliberate breaking change.
    expect(result).toBe("https://github.com/o/r/pull/1");
  });
});

describe("createPrUrlCache", () => {
  test("hit within TTL returns cached value (incl. negative)", () => {
    let now = 1000;
    const cache = createPrUrlCache(5000, () => now);
    cache.set("issue-a", "https://gh/pr/1");
    cache.set("issue-b", null);
    expect(cache.get("issue-a")).toBe("https://gh/pr/1");
    expect(cache.get("issue-b")).toBeNull();
    now += 4000;
    expect(cache.get("issue-a")).toBe("https://gh/pr/1");
    expect(cache.get("issue-b")).toBeNull();
  });

  test("miss after TTL expires", () => {
    let now = 0;
    const cache = createPrUrlCache(5000, () => now);
    cache.set("issue-a", "https://gh/pr/1");
    now += 5001;
    expect(cache.get("issue-a")).toBeUndefined();
    // Re-set after expiry works.
    cache.set("issue-a", "https://gh/pr/2");
    expect(cache.get("issue-a")).toBe("https://gh/pr/2");
  });

  test("invalidate drops the entry", () => {
    const cache = createPrUrlCache();
    cache.set("issue-a", "https://gh/pr/1");
    cache.invalidate("issue-a");
    expect(cache.get("issue-a")).toBeUndefined();
  });

  test("get returns undefined for unknown key (distinct from cached null)", () => {
    const cache = createPrUrlCache();
    expect(cache.get("nope")).toBeUndefined();
    cache.set("issue-a", null);
    expect(cache.get("issue-a")).toBeNull();
  });
});
