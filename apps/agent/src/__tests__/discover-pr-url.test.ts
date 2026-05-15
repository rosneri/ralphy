import { describe, expect, test } from "bun:test";
import { pickOpenPrUrlFromAttachments } from "../agent/wire";
import type { CmdRunner } from "../agent/pr";

type GhCall = { args: string[]; cwd: string };

function makeRunner(
  states: Record<string, "OPEN" | "MERGED" | "CLOSED" | "throw">,
  calls: GhCall[] = [],
): CmdRunner {
  return {
    run: async (args, cwd) => {
      calls.push({ args, cwd });
      const url = args[3] ?? "";
      const verdict = states[url];
      if (verdict === "throw") {
        throw new Error("gh boom");
      }
      return { stdout: JSON.stringify({ state: verdict ?? "OPEN" }), stderr: "" };
    },
  };
}

describe("pickOpenPrUrlFromAttachments", () => {
  test("returns null when no attachment is a GitHub PR URL", async () => {
    const calls: GhCall[] = [];
    const runner = makeRunner({}, calls);
    const logs: string[] = [];
    const result = await pickOpenPrUrlFromAttachments(
      ["https://example.com/something", "https://github.com/x/y/issues/1"],
      "RLF-1",
      runner,
      "/cwd",
      (m) => logs.push(m),
    );
    expect(result).toEqual({ url: null, sawNonOpenPr: false });
    expect(calls).toEqual([]);
    expect(logs).toEqual([]);
  });

  test("skips MERGED PRs, returns null with sawNonOpenPr=true", async () => {
    const url = "https://github.com/o/r/pull/42";
    const calls: GhCall[] = [];
    const runner = makeRunner({ [url]: "MERGED" }, calls);
    const logs: string[] = [];
    const result = await pickOpenPrUrlFromAttachments([url], "RLF-2", runner, "/cwd", (m) =>
      logs.push(m),
    );
    expect(result).toEqual({ url: null, sawNonOpenPr: true });
    expect(calls).toHaveLength(1);
    // No noisy log line for the merged PR.
    expect(logs).toEqual([]);
  });

  test("skips CLOSED PRs, returns null with sawNonOpenPr=true", async () => {
    const url = "https://github.com/o/r/pull/99";
    const runner = makeRunner({ [url]: "CLOSED" });
    const result = await pickOpenPrUrlFromAttachments([url], "RLF-2b", runner, "/cwd", () => {});
    expect(result).toEqual({ url: null, sawNonOpenPr: true });
  });

  test("returns the first OPEN PR URL, skipping merged ones in order", async () => {
    const merged = "https://github.com/o/r/pull/1";
    const open = "https://github.com/o/r/pull/2";
    const calls: GhCall[] = [];
    const runner = makeRunner({ [merged]: "MERGED", [open]: "OPEN" }, calls);
    const logs: string[] = [];
    const result = await pickOpenPrUrlFromAttachments(
      [merged, open],
      "RLF-3",
      runner,
      "/cwd",
      (m) => logs.push(m),
    );
    expect(result.url).toBe(open);
    expect(calls.map((c) => c.args[3])).toEqual([merged, open]);
  });

  test("returns the OPEN URL immediately without checking later candidates", async () => {
    const open = "https://github.com/o/r/pull/5";
    const later = "https://github.com/o/r/pull/6";
    const calls: GhCall[] = [];
    const runner = makeRunner({ [open]: "OPEN", [later]: "OPEN" }, calls);
    const result = await pickOpenPrUrlFromAttachments(
      [open, later],
      "RLF-4",
      runner,
      "/cwd",
      () => {},
    );
    expect(result).toEqual({ url: open, sawNonOpenPr: false });
    expect(calls).toHaveLength(1);
  });

  test("logs yellow on per-URL gh failure but continues to next candidate", async () => {
    const broken = "https://github.com/o/r/pull/7";
    const open = "https://github.com/o/r/pull/8";
    const runner = makeRunner({ [broken]: "throw", [open]: "OPEN" });
    const logs: { msg: string; color?: string }[] = [];
    const result = await pickOpenPrUrlFromAttachments(
      [broken, open],
      "RLF-5",
      runner,
      "/cwd",
      (msg, color) => logs.push(color === undefined ? { msg } : { msg, color }),
    );
    expect(result.url).toBe(open);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.color).toBe("yellow");
    expect(logs[0]!.msg).toContain(broken);
    expect(logs[0]!.msg).toContain("RLF-5");
  });

  test("gh failure on only candidate keeps sawNonOpenPr=false", async () => {
    const broken = "https://github.com/o/r/pull/10";
    const runner = makeRunner({ [broken]: "throw" });
    const result = await pickOpenPrUrlFromAttachments([broken], "RLF-6", runner, "/cwd", () => {});
    expect(result).toEqual({ url: null, sawNonOpenPr: false });
  });
});
