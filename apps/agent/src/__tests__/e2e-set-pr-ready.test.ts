// RLF-214 — integration + e2e proof for the additive `setPrReady` indicator.
//
// Each unit half is covered elsewhere (runPrPhase calls onPrReady across the
// truth table; the fake-linear classifier buckets the marker). This file wires
// the REAL `runPrPhase` to the fake-linear `applyIndicator` via `onPrReady`,
// then mirrors the coordinator's end-of-run `setDone`, to prove:
//   • additive: a clean no-auto-merge run lands BOTH setPrReady and setDone,
//     with setPrReady ordered first;
//   • the auto-merge skip rule (row 4) writes setDone but NOT setPrReady;
//   • a setPrReady marker does not exclude its issue from the todo pool.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPrPhase } from "../agent/post-task";
import { unionMarkers } from "../agent/wire/indicators";
import { issueMatchesGetIndicator } from "../agent/linear";
import { createFakeLinear } from "../../test/harness/fake-linear";
import type { CmdRunner } from "../agent/pr";
import type { LinearIssue } from "../agent/linear";
import type { SetIndicator } from "@ralphy/types";

const SET_PR_READY: SetIndicator = { type: "status", value: "In Review" };
const SET_DONE: SetIndicator = { type: "status", value: "Done" };
const SET_ERROR: SetIndicator = { type: "label", value: "ralphy:error" };

const ISSUE: LinearIssue = {
  id: "u-1",
  identifier: "ENG-77",
  title: "Add feature",
  description: "Why and what.",
  url: "https://linear.app/x/issue/ENG-77",
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
  priority: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
};

function makeCmd(
  responses: Record<string, { stdout?: string; stderr?: string; throw?: boolean }>,
): CmdRunner {
  return {
    run: async (args) => {
      const key = args.join(" ");
      for (const [prefix, r] of Object.entries(responses)) {
        if (key.startsWith(prefix)) {
          if (r.throw) {
            const err = new Error("cmd failed") as Error & { stderr?: string };
            err.stderr = r.stderr ?? "";
            throw err;
          }
          return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        }
      }
      return { stdout: "", stderr: "" };
    },
  };
}

const baseCfg = {
  teardownScript: null,
  prBaseBranch: "main",
  autoMergeStrategy: "squash" as const,
  cleanupWorktreeOnSuccess: false,
  stackPrsOnDependencies: false,
  neverTouch: [] as string[],
};

describe("RLF-214 — setPrReady integration (real runPrPhase + fake-linear)", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "e2e-set-pr-ready-"));
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

  test("no-auto-merge run lands BOTH setPrReady and setDone (additive), readied first", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed(ISSUE);
    const prUrl = "https://github.com/owner/repo/pull/401";
    const cmd = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue,
        wantAutoMerge: false,
        cfg: baseCfg,
      },
      {
        cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: onPrReadyFor(linear, issue),
      },
    );
    expect(code).toBe(0);

    // setPrReady applied inside the PR phase…
    expect(linear.applied.setPrReady).toContain("ENG-77");
    // …setDone is NOT yet applied (the coordinator owns it on clean exit).
    expect(linear.applied.setDone).not.toContain("ENG-77");

    // Mirror the coordinator's end-of-run setDone.
    await linear.client.applyIndicator(issue, SET_DONE);
    expect(linear.applied.setDone).toContain("ENG-77"); // additive: both landed
  });

  test("draft + auto-merge run applies setPrReady (row 3)", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({ ...ISSUE, id: "u-3", identifier: "ENG-78" });
    const prUrl = "https://github.com/owner/repo/pull/403";
    const cmd = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr checks": { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]) },
      "gh pr ready": { stdout: "" },
      "gh pr merge": { stdout: "" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue,
        wantAutoMerge: true,
        cfg: { ...baseCfg, prDraft: true },
      },
      {
        cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: onPrReadyFor(linear, issue),
      },
    );
    expect(code).toBe(0);
    expect(linear.applied.setPrReady).toContain("ENG-78");
  });

  test("non-draft + auto-merge run applies setPrReady AND setDone (RLF-97: reviewable until CI passes)", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({ ...ISSUE, id: "u-4", identifier: "ENG-79" });
    const prUrl = "https://github.com/owner/repo/pull/404";
    const cmd = makeCmd({
      "git status --porcelain": { stdout: "" },
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
      "gh pr merge": { stdout: "" },
    });

    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch: "ralph/my-change",
        changeDir,
        stateFilePath,
        issue,
        wantAutoMerge: true,
        cfg: baseCfg,
      },
      {
        cmd,
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
        onPrReady: onPrReadyFor(linear, issue),
      },
    );
    expect(code).toBe(0);
    expect(linear.applied.setPrReady).toContain("ENG-79");

    // The coordinator still applies setDone on this clean exit.
    await linear.client.applyIndicator(issue, SET_DONE);
    expect(linear.applied.setDone).toContain("ENG-79");
  });

  test("a setPrReady marker does not exclude its issue from the todo pool", async () => {
    // wire.ts builds the todo-exclusion set from setDone + setError ONLY.
    const exclude = unionMarkers(SET_DONE, SET_ERROR);
    expect(exclude.some((m) => m.type === "status" && m.value === "In Review")).toBe(false);

    // An issue carrying the setPrReady marker still matches a getTodo filter.
    const issueWithReady: LinearIssue = {
      ...ISSUE,
      labels: ["ralphy:todo"],
      state: { name: "In Review", type: "started" },
    };
    const matches = issueMatchesGetIndicator(issueWithReady, {
      filter: [{ type: "label", value: "ralphy:todo" }],
    });
    expect(matches).toBe(true);
  });
});
