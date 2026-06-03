// End-to-end proof for the additive `setPrReady` indicator over a STATEFUL
// GitHub mock — the true-e2e companion to e2e-set-pr-ready.test.ts (which uses
// a flat keyed stub and only asserts the marker buckets).
//
// This mirrors e2e-draft-pr-chain.test.ts: a single stateful fake of git + gh
// models one PR per branch with a draft flag, so the PR phase observes — and
// drives — the real `gh pr ready` / `gh pr merge --auto` transitions. We wire
// the REAL `runPrPhase` to the fake-linear `applyIndicator` via `onPrReady`
// (exactly as wire/spawn/worker.ts does) and mirror the coordinator's
// end-of-run `setDone`, to prove the full chain:
//   • row 2 (auto-merge OFF, prDraft): the PR is flipped draft -> ready,
//     setPrReady lands at that point, then setDone at completion — additive,
//     readied first;
//   • row 4 (auto-merge ON, non-draft): the PR goes straight to merge with NO
//     `gh pr ready` and NO setPrReady write, yet setDone still lands.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPrPhase, _resetRepoAutoMergeCache } from "../agent/post-task";
import { createFakeLinear } from "../../test/harness/fake-linear";
import type { CmdRunner } from "../agent/pr";
import type { LinearIssue } from "../agent/linear";
import type { SetIndicator } from "@ralphy/types";

const SET_PR_READY: SetIndicator = { type: "status", value: "In Review" };
const SET_DONE: SetIndicator = { type: "status", value: "Done" };

const ISSUE: LinearIssue = {
  id: "u-1",
  identifier: "ENG-91",
  title: "Add feature",
  description: "Why and what.",
  url: "https://linear.app/x/issue/ENG-91",
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
  priority: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
};

/**
 * A single stateful fake of `git` + `gh` shared by the PR phase. Models one PR
 * per branch with a draft flag and records the merge/ready transitions so the
 * test can assert the PR was actually driven to ready (or merged) rather than
 * just that a marker bucket was touched.
 */
function makeGitHub() {
  const prUrlByBranch = new Map<string, string>();
  const draftByUrl = new Map<string, boolean>();
  const readyCalls: string[] = [];
  const autoMergeCalls: string[] = [];
  const manualMergeCalls: string[] = [];
  const createCalls: string[][] = [];
  let lastPushedBranch: string | null = null;
  let nextPr = 900;

  const cmd: CmdRunner = {
    run: async (args) => {
      const key = args.join(" ");

      if (key.startsWith("git push")) {
        const i = args.indexOf("origin");
        if (i >= 0 && args[i + 1]) lastPushedBranch = args[i + 1]!;
        return { stdout: "", stderr: "" };
      }
      if (key.startsWith("git log")) return { stdout: "abc committed work", stderr: "" };
      if (key.startsWith("git diff")) return { stdout: "", stderr: "" };
      if (key.startsWith("git status --porcelain")) return { stdout: "", stderr: "" };

      if (key.startsWith("gh pr list")) {
        const i = args.indexOf("--head");
        const branch = i >= 0 ? args[i + 1] : undefined;
        const url = branch ? (prUrlByBranch.get(branch) ?? "") : "";
        return { stdout: url, stderr: "" };
      }
      if (key.startsWith("gh pr create")) {
        createCalls.push([...args]);
        const url = `https://github.com/owner/repo/pull/${nextPr++}`;
        if (lastPushedBranch) prUrlByBranch.set(lastPushedBranch, url);
        draftByUrl.set(url, args.includes("--draft"));
        return { stdout: url, stderr: "" };
      }
      if (key.startsWith("gh pr checks")) {
        return { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]), stderr: "" };
      }
      if (key.startsWith("gh pr ready")) {
        const url = args[3]!;
        draftByUrl.set(url, false);
        readyCalls.push(url);
        return { stdout: "", stderr: "" };
      }
      if (key.startsWith("gh pr merge")) {
        const url = args[3]!;
        if (args.includes("--auto")) autoMergeCalls.push(url);
        else manualMergeCalls.push(url);
        return { stdout: "", stderr: "" };
      }
      // `gh api repos/<owner>/<repo>` auto-merge probe: empty ⇒ "could not
      // determine" ⇒ treated as enabled, so the --auto path is exercised.
      return { stdout: "", stderr: "" };
    },
  };

  return {
    cmd,
    prUrlByBranch,
    draftByUrl,
    readyCalls,
    autoMergeCalls,
    manualMergeCalls,
    createCalls,
  };
}

const baseCfg = {
  teardownScript: null,
  prBaseBranch: "main",
  autoMergeStrategy: "squash" as const,
  maxCiFixAttempts: 3,
  ciPollIntervalSeconds: 0,
  cleanupWorktreeOnSuccess: false,
  ignoreCiChecks: [] as string[],
  stackPrsOnDependencies: false,
  neverTouch: [] as string[],
};

describe("e2e — setPrReady chain over a stateful GitHub mock", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    _resetRepoAutoMergeCache();
    tmpDir = await mkdtemp(join(tmpdir(), "e2e-set-pr-ready-chain-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Build the `onPrReady` dep exactly as wire/spawn/worker.ts does. */
  function onPrReadyFor(linear: ReturnType<typeof createFakeLinear>, issue: LinearIssue) {
    return async () => {
      await linear.client.applyIndicator(issue, SET_PR_READY);
    };
  }

  test("auto-merge OFF: PR is driven draft -> ready, setPrReady lands, then Done", async () => {
    const branch = "ralph/my-change";
    const gh = makeGitHub();
    const linear = createFakeLinear();
    const issue = linear.seed(ISSUE);

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch,
        changeDir,
        stateFilePath,
        issue,
        wantFixCi: true,
        wantAutoMerge: false,
        cfg: { ...baseCfg, prDraft: true },
      },
      {
        cmd: gh.cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: onPrReadyFor(linear, issue),
      },
    );
    expect(code).toBe(0);

    // The PR was opened as a draft and flipped draft -> ready by the PR phase.
    const url = gh.prUrlByBranch.get(branch)!;
    expect(gh.createCalls[0]).toContain("--draft");
    expect(gh.readyCalls).toEqual([url]);
    expect(gh.draftByUrl.get(url)).toBe(false);
    // No merge happened — the ready PR is left for a human.
    expect(gh.autoMergeCalls).toHaveLength(0);
    expect(gh.manualMergeCalls).toHaveLength(0);

    // The ready transition was applied to Linear at the PR-phase success point…
    expect(linear.applied.setPrReady).toContain("ENG-91");
    // …and setDone is NOT yet applied (the coordinator owns it on clean exit).
    expect(linear.applied.setDone).not.toContain("ENG-91");

    // Mirror the coordinator's end-of-run setDone — additive: both landed.
    await linear.client.applyIndicator(issue, SET_DONE);
    expect(linear.applied.setDone).toContain("ENG-91");
  });

  test("auto-merge ON (non-draft): straight to merge, no setPrReady, still Done", async () => {
    const branch = "ralph/my-change";
    const gh = makeGitHub();
    const linear = createFakeLinear();
    const issue = linear.seed({ ...ISSUE, id: "u-2", identifier: "ENG-92" });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch,
        changeDir,
        stateFilePath,
        issue,
        wantFixCi: false,
        wantAutoMerge: true,
        cfg: baseCfg,
      },
      {
        cmd: gh.cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: onPrReadyFor(linear, issue),
      },
    );
    expect(code).toBe(0);

    // Non-draft create, auto-merge enabled immediately, never readied.
    const url = gh.prUrlByBranch.get(branch)!;
    expect(gh.createCalls[0]).not.toContain("--draft");
    expect(gh.readyCalls).toHaveLength(0);
    expect(gh.autoMergeCalls).toEqual([url]);

    // No intermediate setPrReady write on the immediate auto-merge path…
    expect(linear.applied.setPrReady).not.toContain("ENG-92");

    // …but the coordinator still applies setDone on this clean exit.
    await linear.client.applyIndicator(issue, SET_DONE);
    expect(linear.applied.setDone).toContain("ENG-92");
  });
});
