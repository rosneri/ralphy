import { describe, expect, test } from "bun:test";
import { pickOpenPrUrlFromAttachments } from "../agent/wire";
import { createPrDiscovery } from "../agent/wire/pr-discovery";
import { createFakeCodeHost } from "@ralphy/codehost/testing";
import type { CodeHost, PullRequestState } from "@ralphy/codehost";
import type { CmdRunner } from "../agent/pr";
import { PollContext } from "../shared/capabilities/poll-context";
import { makeTrackedIssue } from "@ralphy/tracker/testing";

/** Build a CodeHost whose `getPullRequestState` is scripted per-URL. "throw"
 *  makes the probe reject (mirrors a `gh` failure). Probed URLs are recorded. */
function makeHost(
  states: Record<string, PullRequestState | "throw">,
  probed: string[] = [],
): CodeHost {
  const host = createFakeCodeHost();
  return {
    ...host,
    async getPullRequestState(url) {
      probed.push(url);
      const verdict = states[url];
      if (verdict === "throw") throw new Error("gh boom");
      return verdict ?? "open";
    },
  };
}

describe("pickOpenPrUrlFromAttachments", () => {
  test("returns null when no attachment is a GitHub PR URL", async () => {
    const probed: string[] = [];
    const host = makeHost({}, probed);
    const logs: string[] = [];
    const result = await pickOpenPrUrlFromAttachments(
      ["https://example.com/something", "https://github.com/x/y/issues/1"],
      "RLF-1",
      host,
      (m) => logs.push(m),
    );
    expect(result).toEqual({ url: null, sawNonOpenPr: false });
    expect(probed).toEqual([]);
    expect(logs).toEqual([]);
  });

  test("skips merged PRs, returns null with sawNonOpenPr=true", async () => {
    const url = "https://github.com/o/r/pull/42";
    const probed: string[] = [];
    const host = makeHost({ [url]: "merged" }, probed);
    const logs: string[] = [];
    const result = await pickOpenPrUrlFromAttachments([url], "RLF-2", host, (m) => logs.push(m));
    expect(result).toEqual({ url: null, sawNonOpenPr: true });
    expect(probed).toHaveLength(1);
    // No noisy log line for the merged PR.
    expect(logs).toEqual([]);
  });

  test("skips closed PRs, returns null with sawNonOpenPr=true", async () => {
    const url = "https://github.com/o/r/pull/99";
    const host = makeHost({ [url]: "closed" });
    const result = await pickOpenPrUrlFromAttachments([url], "RLF-2b", host, () => {});
    expect(result).toEqual({ url: null, sawNonOpenPr: true });
  });

  test("returns the first open PR URL, skipping merged ones in order", async () => {
    const merged = "https://github.com/o/r/pull/1";
    const open = "https://github.com/o/r/pull/2";
    const probed: string[] = [];
    const host = makeHost({ [merged]: "merged", [open]: "open" }, probed);
    const logs: string[] = [];
    const result = await pickOpenPrUrlFromAttachments([merged, open], "RLF-3", host, (m) =>
      logs.push(m),
    );
    expect(result.url).toBe(open);
    expect(probed).toEqual([merged, open]);
  });

  test("returns the open URL immediately without checking later candidates", async () => {
    const open = "https://github.com/o/r/pull/5";
    const later = "https://github.com/o/r/pull/6";
    const probed: string[] = [];
    const host = makeHost({ [open]: "open", [later]: "open" }, probed);
    const result = await pickOpenPrUrlFromAttachments([open, later], "RLF-4", host, () => {});
    expect(result).toEqual({ url: open, sawNonOpenPr: false });
    expect(probed).toHaveLength(1);
  });

  test("logs yellow on per-URL probe failure but continues to next candidate", async () => {
    const broken = "https://github.com/o/r/pull/7";
    const open = "https://github.com/o/r/pull/8";
    const host = makeHost({ [broken]: "throw", [open]: "open" });
    const logs: { msg: string; color?: string }[] = [];
    const result = await pickOpenPrUrlFromAttachments([broken, open], "RLF-5", host, (msg, color) =>
      logs.push(color === undefined ? { msg } : { msg, color }),
    );
    expect(result.url).toBe(open);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.color).toBe("yellow");
    expect(logs[0]!.msg).toContain(broken);
    expect(logs[0]!.msg).toContain("RLF-5");
  });

  test("probe failure on only candidate keeps sawNonOpenPr=false", async () => {
    const broken = "https://github.com/o/r/pull/10";
    const host = makeHost({ [broken]: "throw" });
    const result = await pickOpenPrUrlFromAttachments([broken], "RLF-6", host, () => {});
    expect(result).toEqual({ url: null, sawNonOpenPr: false });
  });
});

describe("createPrDiscovery — no-PR log routing", () => {
  /** A runner whose `gh pr list` returns no rows → no GitHub PR discovered. */
  const emptyRunner: CmdRunner = { run: async () => ({ stdout: "", stderr: "" }) };

  test("the recurring 'no PR found' line goes to onFileLog, not the agent view", async () => {
    const onLogLines: string[] = [];
    const diagLines: string[] = [];
    const fileLines: string[] = [];
    const discovery = createPrDiscovery({
      projectRoot: "/wt",
      cmdRunner: emptyRunner,
      codeHost: createFakeCodeHost(),
      // No tracker PR links either → discovery resolves to null.
      fetchPullRequestLinks: async () => [],
      onLog: (t) => onLogLines.push(t),
      onFileLog: (t) => fileLines.push(t),
      diag: (_area, message) => diagLines.push(message),
      prByChange: new Map<string, string>(),
      getPollContext: () => new PollContext(),
    });

    const result = await discovery.checkPrStatus(makeTrackedIssue({ identifier: "ENG-7" }));

    expect(result).toBeNull();
    // File sink gets the diagnostic; the agent-view channels stay clean.
    expect(fileLines.some((t) => t.includes("ENG-7") && t.includes("no PR found"))).toBe(true);
    expect(onLogLines.some((t) => t.includes("no PR found"))).toBe(false);
    expect(diagLines.some((t) => t.includes("no PR found"))).toBe(false);
  });

  test("falls back to the visible diag channel when no file sink is wired", async () => {
    const diagLines: string[] = [];
    const discovery = createPrDiscovery({
      projectRoot: "/wt",
      cmdRunner: emptyRunner,
      codeHost: createFakeCodeHost(),
      fetchPullRequestLinks: async () => [],
      onLog: () => {},
      diag: (_area, message) => diagLines.push(message),
      prByChange: new Map<string, string>(),
      getPollContext: () => new PollContext(),
    });

    await discovery.checkPrStatus(makeTrackedIssue({ identifier: "ENG-8" }));

    expect(diagLines.some((t) => t.includes("ENG-8") && t.includes("no PR found"))).toBe(true);
  });
});
