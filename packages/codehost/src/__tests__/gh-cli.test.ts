import { describe, expect, test } from "bun:test";
import { createGhCliCodeHost } from "../gh-cli";
import type { CmdRunner } from "../types";

/** Scripted CmdRunner: responses keyed by the joined command prefix; every
 *  invocation recorded for assertions. */
function scriptedRunner(script: Record<string, { stdout?: string; error?: string }>) {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      const key = Object.keys(script).find((k) => cmd.join(" ").startsWith(k));
      const entry = key ? script[key] : undefined;
      if (entry?.error !== undefined) {
        const err = new Error(entry.error) as Error & { stderr?: string; stdout?: string };
        err.stderr = entry.error;
        err.stdout = entry.stdout ?? "";
        throw err;
      }
      return { stdout: entry?.stdout ?? "", stderr: "" };
    },
  };
  return { runner, calls };
}

describe("createGhCliCodeHost", () => {
  test("getPullRequestState maps OPEN/MERGED/CLOSED", async () => {
    for (const [raw, want] of [
      ["OPEN", "open"],
      ["MERGED", "merged"],
      ["CLOSED", "closed"],
    ] as const) {
      const { runner } = scriptedRunner({
        "gh pr view": { stdout: JSON.stringify({ state: raw }) },
      });
      const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
      expect(await host.getPullRequestState("https://github.com/o/r/pull/1")).toBe(want);
    }
  });

  test("getPullRequestDetails returns normalized state + branch/title/url", async () => {
    const { runner, calls } = scriptedRunner({
      "gh pr view": {
        stdout: JSON.stringify({
          state: "OPEN",
          headRefName: "feature/x",
          title: "RLF-42: build it",
          url: "https://github.com/o/r/pull/9",
        }),
      },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    const details = await host.getPullRequestDetails("https://github.com/o/r/pull/9");
    expect(details).toEqual({
      state: "open",
      headRefName: "feature/x",
      title: "RLF-42: build it",
      url: "https://github.com/o/r/pull/9",
    });
    // Probes the richer field set in one call.
    expect(calls[0]).toEqual([
      "gh",
      "pr",
      "view",
      "https://github.com/o/r/pull/9",
      "--json",
      "state,headRefName,title,url",
    ]);
  });

  test("getPullRequestDetails defaults missing fields (url falls back to input)", async () => {
    const inputUrl = "https://github.com/o/r/pull/3";
    const { runner } = scriptedRunner({
      "gh pr view": { stdout: JSON.stringify({ state: "MERGED" }) },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.getPullRequestDetails(inputUrl)).toEqual({
      state: "merged",
      headRefName: "",
      title: "",
      url: inputUrl,
    });
  });

  test("getChecksStatus: 'no checks reported' is a pass", async () => {
    const { runner } = scriptedRunner({
      "gh pr checks": { error: "no checks reported on the 'x' branch" },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    const status = await host.getChecksStatus("https://github.com/o/r/pull/1");
    expect(status.bucket).toBe("pass");
  });

  test("getChecksStatus: partial-access blob with salvageable JSON is salvaged", async () => {
    const checks = [
      { name: "build", bucket: "pass" },
      { name: "lint", bucket: "fail", link: "https://github.com/o/r/actions/runs/777/job/9" },
    ];
    const { runner } = scriptedRunner({
      "gh pr checks": {
        error: "Resource not accessible by personal access token",
        stdout: JSON.stringify(checks),
      },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    const status = await host.getChecksStatus("https://github.com/o/r/pull/1");
    expect(status.bucket).toBe("fail");
    expect(status.failedRunIds).toEqual(["777"]);
    expect(status.failedCheckNames).toEqual(["lint"]);
  });

  test("getChecksStatus: ignored checks and skips never fail the bucket", async () => {
    const checks = [
      { name: "Flaky Canary", bucket: "fail" },
      { name: "optional", bucket: "skipping" },
      { name: "build", bucket: "pass" },
    ];
    const { runner } = scriptedRunner({
      "gh pr checks": { stdout: JSON.stringify(checks) },
    });
    const host = createGhCliCodeHost({
      cmdRunner: runner,
      cwd: "/repo",
      ignoreChecks: ["flaky canary"],
    });
    const status = await host.getChecksStatus("https://github.com/o/r/pull/1");
    expect(status.bucket).toBe("pass");
  });

  test("createPullRequest is idempotent: returns the existing open PR's URL", async () => {
    const { runner, calls } = scriptedRunner({
      "git push": {},
      "gh pr list": { stdout: "https://github.com/o/r/pull/42\n" },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    const url = await host.createPullRequest({
      branch: "feat/x",
      base: "main",
      title: "t",
      body: "b",
      labels: ["ralph"],
    });
    expect(url).toBe("https://github.com/o/r/pull/42");
    expect(calls.some((c) => c[0] === "gh" && c[2] === "create")).toBe(false);
    const labelCall = calls.find((c) => c.join(" ").startsWith("gh pr edit"));
    expect(labelCall).toContain("--add-label");
  });

  test("createPullRequest creates when no PR exists, honoring draft", async () => {
    const { runner, calls } = scriptedRunner({
      "git push": {},
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/o/r/pull/7\n" },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    const url = await host.createPullRequest({
      branch: "feat/x",
      base: "main",
      title: "t",
      body: "b",
      draft: true,
    });
    expect(url).toBe("https://github.com/o/r/pull/7");
    const create = calls.find((c) => c.join(" ").startsWith("gh pr create"));
    expect(create).toContain("--draft");
  });

  test("findOpenPullRequestForBranch returns the open PR URL (idempotency query)", async () => {
    const { runner, calls } = scriptedRunner({
      "gh pr list": { stdout: "https://github.com/o/r/pull/12\n" },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.findOpenPullRequestForBranch("feat/x")).toBe(
      "https://github.com/o/r/pull/12",
    );
    expect(calls[0]).toEqual([
      "gh",
      "pr",
      "list",
      "--head",
      "feat/x",
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      ".[0].url // empty",
    ]);
  });

  test("findOpenPullRequestForBranch returns null when none is open", async () => {
    const { runner } = scriptedRunner({ "gh pr list": { stdout: "\n" } });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.findOpenPullRequestForBranch("feat/x")).toBeNull();
  });

  test("findOpenPullRequestForBranch swallows gh failures to null (best-effort)", async () => {
    const { runner } = scriptedRunner({ "gh pr list": { error: "gh: network error" } });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.findOpenPullRequestForBranch("feat/x")).toBeNull();
  });

  test("isAutoMergeAllowed maps true/false and caches per repo", async () => {
    const { runner, calls } = scriptedRunner({
      "gh api repos/o/r": { stdout: "true\n" },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.isAutoMergeAllowed("https://github.com/o/r/pull/1")).toBe(true);
    // A second PR in the same repo is served from the cache — no extra gh hop.
    expect(await host.isAutoMergeAllowed("https://github.com/o/r/pull/2")).toBe(true);
    expect(calls.filter((c) => c[0] === "gh" && c[1] === "api")).toHaveLength(1);
  });

  test("isAutoMergeAllowed returns false when the repo disables it", async () => {
    const { runner } = scriptedRunner({ "gh api repos/o/r": { stdout: "false\n" } });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.isAutoMergeAllowed("https://github.com/o/r/pull/1")).toBe(false);
  });

  test("isAutoMergeAllowed returns null on malformed URL without probing gh", async () => {
    const { runner, calls } = scriptedRunner({ "gh api": { stdout: "true\n" } });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.isAutoMergeAllowed("not-a-pr-url")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("isAutoMergeAllowed returns null on gh failure and caches the null", async () => {
    const { runner, calls } = scriptedRunner({ "gh api repos/o/r": { error: "gh boom" } });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.isAutoMergeAllowed("https://github.com/o/r/pull/1")).toBeNull();
    // Cached: a repeat probe for the same repo does not re-shell gh.
    expect(await host.isAutoMergeAllowed("https://github.com/o/r/pull/9")).toBeNull();
    expect(calls.filter((c) => c[0] === "gh" && c[1] === "api")).toHaveLength(1);
  });

  test("isAutoMergeAllowed returns null on an unparseable response", async () => {
    const { runner } = scriptedRunner({ "gh api repos/o/r": { stdout: "null\n" } });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.isAutoMergeAllowed("https://github.com/o/r/pull/1")).toBeNull();
  });

  test("ready / auto-merge / merge issue the expected gh transitions", async () => {
    const { runner, calls } = scriptedRunner({ "gh pr": {} });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    await host.markReady("URL");
    await host.enableAutoMerge("URL", "squash");
    await host.merge("URL", "rebase");
    expect(calls[0]).toEqual(["gh", "pr", "ready", "URL"]);
    expect(calls[1]).toEqual(["gh", "pr", "merge", "URL", "--auto", "--squash"]);
    expect(calls[2]).toEqual(["gh", "pr", "merge", "URL", "--rebase"]);
  });
});
