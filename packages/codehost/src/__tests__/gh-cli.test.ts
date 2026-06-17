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

  // --- Local git operations (RLF-255 9e) ------------------------------------

  test("headSha runs in the supplied cwd and trims the SHA", async () => {
    const { runner, calls } = scriptedRunner({ "git rev-parse HEAD": { stdout: "abc123\n" } });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.headSha("/worktree")).toBe("abc123");
    expect(calls[0]).toEqual(["git", "rev-parse", "HEAD"]);
  });

  test("isAncestor returns true on success, false on a non-zero git exit", async () => {
    const ok = scriptedRunner({ "git merge-base --is-ancestor": {} });
    const hostOk = createGhCliCodeHost({ cmdRunner: ok.runner, cwd: "/repo" });
    expect(await hostOk.isAncestor("pre", "post", "/wt")).toBe(true);
    expect(ok.calls[0]).toEqual(["git", "merge-base", "--is-ancestor", "pre", "post"]);

    const fail = scriptedRunner({ "git merge-base --is-ancestor": { error: "not an ancestor" } });
    const hostFail = createGhCliCodeHost({ cmdRunner: fail.runner, cwd: "/repo" });
    expect(await hostFail.isAncestor("pre", "post", "/wt")).toBe(false);
  });

  test("fetchBranch / pullBranch issue the expected git arg-arrays", async () => {
    const { runner, calls } = scriptedRunner({ "git fetch": {}, "git pull": {} });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    await host.fetchBranch("feat/x", "/wt");
    await host.pullBranch("feat/x", "/wt");
    expect(calls[0]).toEqual(["git", "fetch", "origin", "feat/x"]);
    expect(calls[1]).toEqual([
      "git",
      "pull",
      "--no-rebase",
      "--autostash",
      "--no-edit",
      "origin",
      "feat/x",
    ]);
  });

  test("pullBranch propagates the merge error with stderr/stdout intact", async () => {
    const { runner } = scriptedRunner({
      "git pull": {
        error: "CONFLICT (content): Merge conflict in foo.ts",
        stdout: "Auto-merging foo.ts",
      },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    let err: (Error & { stderr?: string; stdout?: string }) | undefined;
    try {
      await host.pullBranch("feat/x", "/wt");
    } catch (e) {
      err = e as Error & { stderr?: string; stdout?: string };
    }
    expect(err?.stderr).toContain("Merge conflict");
    expect(err?.stdout).toContain("Auto-merging");
  });

  test("abortMerge issues git merge --abort", async () => {
    const { runner, calls } = scriptedRunner({ "git merge --abort": {} });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    await host.abortMerge("/wt");
    expect(calls[0]).toEqual(["git", "merge", "--abort"]);
  });

  test("changedFiles splits, trims, and drops blank lines", async () => {
    const { runner, calls } = scriptedRunner({
      "git diff --name-only": { stdout: "foo.ts\n bar.ts \n\nbaz.ts\n" },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.changedFiles("origin/main...HEAD", "/wt")).toEqual([
      "foo.ts",
      "bar.ts",
      "baz.ts",
    ]);
    expect(calls[0]).toEqual(["git", "diff", "--name-only", "origin/main...HEAD"]);
  });

  test("workingTreeStatus returns raw porcelain output", async () => {
    const { runner, calls } = scriptedRunner({
      "git status --porcelain": { stdout: " M foo.ts\n?? bar.ts\n" },
    });
    const host = createGhCliCodeHost({ cmdRunner: runner, cwd: "/repo" });
    expect(await host.workingTreeStatus("/wt")).toBe(" M foo.ts\n?? bar.ts\n");
    expect(calls[0]).toEqual(["git", "status", "--porcelain"]);
  });

  test("countCommitsAhead parses the count, defaulting to 0 when unparseable", async () => {
    const hit = scriptedRunner({ "git rev-list --count": { stdout: "3\n" } });
    const hostHit = createGhCliCodeHost({ cmdRunner: hit.runner, cwd: "/repo" });
    expect(await hostHit.countCommitsAhead("origin/feat..HEAD", "/wt")).toBe(3);
    expect(hit.calls[0]).toEqual(["git", "rev-list", "--count", "origin/feat..HEAD"]);

    const empty = scriptedRunner({ "git rev-list --count": { stdout: "\n" } });
    const hostEmpty = createGhCliCodeHost({ cmdRunner: empty.runner, cwd: "/repo" });
    expect(await hostEmpty.countCommitsAhead("origin/feat..HEAD", "/wt")).toBe(0);
  });
});
