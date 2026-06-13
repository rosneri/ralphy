import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPrPhase, NO_CHANGES_EXIT } from "../agent/post-task";
import type { CmdRunner } from "../agent/pr";
import { createGhCliCodeHost } from "@ralphy/codehost";
const ghHost = (cmd: CmdRunner) => createGhCliCodeHost({ cmdRunner: cmd, cwd: "/wt" });
import type { TrackedIssue } from "@ralphy/tracker";

// runPrPhase must distinguish a no-op branch (history only ever touched meta
// files) from a lost implementation. The no-op path finalizes via
// NO_CHANGES_EXIT without pushing or respawning a doomed reapply loop.

const FAKE_ISSUE: TrackedIssue = {
  id: "issue-1",
  identifier: "LIT-300",
  title: "Eliminate disables",
  url: "https://linear.app/team/issue/LIT-300",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

function makeCmd(responses: Record<string, { stdout?: string }>): {
  cmd: CmdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const cmd: CmdRunner = {
    run: async (args) => {
      calls.push([...args]);
      const key = args.join(" ");
      for (const [prefix, r] of Object.entries(responses)) {
        if (key.startsWith(prefix)) return { stdout: r.stdout ?? "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  };
  return { cmd, calls };
}

// A branch whose net diff AND whole history are meta-only.
const NO_OP_RESPONSES = {
  "git status --porcelain": { stdout: "" },
  "git log --oneline main..HEAD": { stdout: "abc docs(lit-300)" },
  "git diff --name-only origin/main...HEAD": { stdout: "openspec/changes/lit-300/tasks.md" },
  "gh pr list": { stdout: "" }, // not merged
  "git cherry main HEAD": { stdout: "+ abc" },
  "git log --name-only --pretty=format: main..HEAD": {
    stdout: "openspec/changes/lit-300/tasks.md\nopenspec/changes/lit-300/proposal.md",
  },
};

const baseCfg = {
  teardownScript: null,
  prBaseBranch: "main",
  autoMergeStrategy: "squash" as const,
  cleanupWorktreeOnSuccess: false,
  stackPrsOnDependencies: false,
  neverTouch: [],
  metaOnlyFiles: ["openspec/**", "**/tasks.md"],
};

describe("runPrPhase — no-op detection", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-no-op-"));
    changeDir = join(tmpDir, "changes", "lit-300");
    await mkdir(changeDir, { recursive: true });
    stateFilePath = join(tmpDir, ".ralph-state.json");
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns NO_CHANGES_EXIT and never pushes when history is meta-only (flag on)", async () => {
    const { cmd, calls } = makeCmd(NO_OP_RESPONSES);
    const phases: string[] = [];
    let respawns = 0;

    const code = await runPrPhase(
      {
        changeName: "lit-300",
        cwd: tmpDir,
        branch: "ralph/lit-300",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: { ...baseCfg, finalizeNoOpAsDone: true },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: (p) => phases.push(p),
        respawnWorker: async () => {
          respawns += 1;
          return 0;
        },
      },
    );

    expect(code).toBe(NO_CHANGES_EXIT);
    expect(phases).toContain("pr-skipped-noop");
    expect(respawns).toBe(0);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    expect(calls.some((c) => c[0] === "gh" && c[2] === "create")).toBe(false);
  });

  test("falls back to reapply-then-fail when flag is disabled", async () => {
    const { cmd } = makeCmd(NO_OP_RESPONSES);
    let respawns = 0;

    const code = await runPrPhase(
      {
        changeName: "lit-300",
        cwd: tmpDir,
        branch: "ralph/lit-300",
        changeDir,
        stateFilePath,
        issue: FAKE_ISSUE,
        wantAutoMerge: false,
        cfg: { ...baseCfg, finalizeNoOpAsDone: false },
      },
      {
        cmd,
        codeHost: ghHost(cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => {
          respawns += 1;
          return 0;
        },
      },
    );

    // Legacy behavior: treat as lost implementation, exhaust reapply attempts,
    // then give up — does NOT silently finalize as done.
    expect(code).not.toBe(NO_CHANGES_EXIT);
    expect(code).not.toBe(0);
    expect(respawns).toBeGreaterThan(0);
  });
});
