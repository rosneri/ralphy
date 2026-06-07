import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBus, type RalphEvent } from "@ralphy/events";
import { createSpawnWorker } from "../worker";
import { loadRalphyConfig } from "../../../config";
import { parseAgentArgs } from "../../../../cli";
import type { AgentRunners } from "../../runners";
import type { GitRunner } from "../../../worktree";
import type { LinearIssue } from "../../../linear";
import type { AgentCoordinator } from "../../../coordinator";

// Drive `createSpawnWorker` end-to-end through its exit handler with an injected
// `spawnWorker` and a fake `GitRunner`. The sentinel (RLF-224) snapshots the
// project root just before the spawn and again on exit; this harness controls
// what the second project-root `status --porcelain` read returns so we can
// simulate a leak, a clean run, or a git failure. No subprocess, no network.

const CHANGE = "rlf-224-sentinel";

const MINIMAL_WORKFLOW = `---
concurrency: 1
useWorktree: true
linear:
  team: ENG
  indicators:
    getTodo:
      filter:
        - type: status
          value: Todo
    setInProgress:
      type: status
      value: In Progress
    setDone:
      type: status
      value: Done
    setError:
      type: label
      value: ralph:error
---
`;

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "rlf224-wire-"));
  await Bun.write(join(tempDir, "WORKFLOW.md"), MINIMAL_WORKFLOW);
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface HarnessOptions {
  useWorktree?: boolean;
  /** Fake GitRunner; defaults to one that simulates a leak. */
  gitRunner?: GitRunner;
}

interface Harness {
  spawnWorker: (changeName: string) => { exited: Promise<number>; kill: () => void };
  leakEvents: RalphEvent[];
  redLogs: string[];
  redDiags: string[];
}

/**
 * A stateful GitRunner: `rev-parse HEAD` always returns the same sha; the first
 * `status --porcelain` (pre-spawn baseline) returns clean, the second
 * (post-exit) returns whatever `secondStatus` says. Lets a single instance
 * simulate "clean → leaked" or "clean → clean".
 */
function leakingGitRunner(secondStatus: string): GitRunner {
  let statusCalls = 0;
  return {
    run: async (args: string[]) => {
      if (args[0] === "rev-parse") return { stdout: "deadbeef\n", stderr: "" };
      if (args[0] === "status") {
        statusCalls += 1;
        return { stdout: statusCalls === 1 ? "" : secondStatus, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  };
}

async function buildHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const { useWorktree = true, gitRunner = leakingGitRunner(" M src/leaked.ts\n") } = opts;

  const cfg = await loadRalphyConfig(tempDir);
  const args = await parseAgentArgs([]);

  // The worktree cwd must differ from projectRoot for the sentinel to arm.
  const worktreeCwd = join(tempDir, "worktree");
  await mkdir(worktreeCwd, { recursive: true });

  const cwdByChange = new Map<string, string>([[CHANGE, worktreeCwd]]);
  const statesDirByChange = new Map<string, string>([[CHANGE, join(tempDir, ".ralph", "tasks")]]);
  const branchByChange = new Map<string, string>([[CHANGE, "ralph/x"]]);
  const issueByChange = new Map<string, LinearIssue>();

  const coordStub: Pick<AgentCoordinator, "isAwaitingConfirmation"> = {
    isAwaitingConfirmation: () => false,
  };
  const coordRef: { current: AgentCoordinator | null } = {
    current: coordStub as AgentCoordinator,
  };

  const fakePostTask: AgentRunners["runPostTask"] = async () => 0;
  const fakeSpawn: AgentRunners["spawnWorker"] = () => ({
    exited: Promise.resolve(0),
    kill: () => {},
  });

  const bus = createBus();
  const leakEvents: RalphEvent[] = [];
  bus.on("agent_main_checkout_leak", (e) => leakEvents.push(e));

  const redLogs: string[] = [];
  const redDiags: string[] = [];

  const spawnWorker = createSpawnWorker({
    args,
    cfg,
    apiKey: "test-key",
    projectRoot: tempDir,
    statesDir: join(tempDir, ".ralph", "tasks"),
    logsDir: tempDir,
    useWorktree,
    indicators: {},
    cmdRunner: { run: async () => ({ stdout: "", stderr: "" }) },
    gitRunner,
    applyIndicator: async () => {},
    bus,
    onLog: (text, color) => {
      if (color === "red") redLogs.push(text);
    },
    diag: (_area, message, color) => {
      if (color === "red") redDiags.push(message);
    },
    runners: { spawnWorker: fakeSpawn, runPostTask: fakePostTask },
    awaitingChangeSet: new Set<string>(),
    coordRef,
    cwdByChange,
    statesDirByChange,
    branchByChange,
    issueByChange,
    onPrRegistered: () => {},
    runScript: async () => {},
    onWorkerStarted: () => {},
    onWorkerExited: () => {},
  });

  return { spawnWorker, leakEvents, redLogs, redDiags };
}

describe("createSpawnWorker main-checkout sentinel", () => {
  test("a new project-root entry during the run fires one red log + one capture", async () => {
    const h = await buildHarness();
    await h.spawnWorker(CHANGE).exited;

    expect(h.leakEvents.length).toBe(1);
    expect(h.leakEvents[0]).toMatchObject({
      change_name: CHANGE,
      head_moved: false,
      leaked_paths: ["M src/leaked.ts"],
    });
    expect(h.redLogs.length).toBe(1);
    expect(h.redLogs[0]).toContain("M src/leaked.ts");
    expect(h.redDiags.length).toBe(1);
  });

  test("a clean run fires neither log nor capture", async () => {
    const h = await buildHarness({ gitRunner: leakingGitRunner("") });
    await h.spawnWorker(CHANGE).exited;

    expect(h.leakEvents.length).toBe(0);
    expect(h.redLogs.length).toBe(0);
    expect(h.redDiags.length).toBe(0);
  });

  test("useWorktree:false skips the sentinel entirely", async () => {
    const h = await buildHarness({ useWorktree: false });
    await h.spawnWorker(CHANGE).exited;

    expect(h.leakEvents.length).toBe(0);
    expect(h.redLogs.length).toBe(0);
  });

  test("a throwing GitRunner degrades to no-leak (fail open)", async () => {
    const throwing: GitRunner = {
      run: async () => {
        throw new Error("index.lock held");
      },
    };
    const h = await buildHarness({ gitRunner: throwing });
    await h.spawnWorker(CHANGE).exited;

    expect(h.leakEvents.length).toBe(0);
    expect(h.redLogs.length).toBe(0);
  });
});
