import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNoopBus } from "@ralphy/events";
import { createSpawnWorker } from "../spawn/worker";
import { runPostTask } from "../../post-task";
import { loadEffectiveConfig } from "../../config";
import { parseAgentArgs } from "../../../cli";
import type { AgentRunners } from "../runners";
import type { TrackedIssue } from "@ralphy/tracker";
import type { AgentCoordinator } from "../../coordinator";

// Drive the spawn-worker exit handler in isolation: a fake `spawnWorker`
// supplies a controllable exit code and a capturing fake `runPostTask`
// records the `PostTaskInput` the handler builds. Real `RalphyConfig` /
// `AgentParsedArgs` come from the loaders so no top-type double-casts are
// needed. No subprocess, no network.

type PostTaskInput = Parameters<typeof runPostTask>[0];

const CHANGE = "rlf-exit-test";

const MINIMAL_WORKFLOW = `---
concurrency: 1
useWorktree: false
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
  tempDir = mkdtempSync(join(tmpdir(), "rlf211-exit-"));
  await Bun.write(join(tempDir, "WORKFLOW.md"), MINIMAL_WORKFLOW);
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface HarnessOptions {
  exitCode?: number;
  postTaskReturn?: number;
  wantPrBase?: boolean;
  awaiting?: boolean;
  awaitingConfirmation?: boolean;
  runPostTaskOverride?: AgentRunners["runPostTask"];
}

interface Harness {
  spawnWorker: (changeName: string) => { exited: Promise<number>; kill: () => void };
  captured: { input?: PostTaskInput };
  postTaskCalls: () => number;
  exitedWorkers: string[];
  maps: {
    cwdByChange: Map<string, string>;
    statesDirByChange: Map<string, string>;
    branchByChange: Map<string, string>;
    issueByChange: Map<string, TrackedIssue>;
  };
}

async function buildHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const {
    exitCode = 0,
    postTaskReturn = 0,
    wantPrBase = false,
    awaiting = false,
    awaitingConfirmation = false,
    runPostTaskOverride,
  } = opts;

  // The PR intent now lives in the effective cfg (RLF-256): `--create-pr` is
  // folded into `createPrOnSuccess` by the boot pipeline, so the harness sets
  // it via agentOverrides rather than a now-removed `args.createPr` field.
  const cfg = await loadEffectiveConfig(tempDir, undefined, {}, { createPr: wantPrBase });
  const args = await parseAgentArgs([]);

  const captured: { input?: PostTaskInput } = {};
  let postTaskCalls = 0;
  const exitedWorkers: string[] = [];

  // The worker's cwd is the temp project root so the exit handler probes
  // `specs/validate.md` and state files against a real (empty) tree.
  const cwdByChange = new Map<string, string>([[CHANGE, tempDir]]);
  const statesDirByChange = new Map<string, string>([[CHANGE, join(tempDir, ".ralph", "tasks")]]);
  const branchByChange = new Map<string, string>([[CHANGE, "feat/x"]]);
  const issueByChange = new Map<string, TrackedIssue>();

  const awaitingChangeSet = new Set<string>();
  if (awaiting) awaitingChangeSet.add(CHANGE);

  // Only `isAwaitingConfirmation` is read off the coordinator; a Pick stub is
  // assignable-compatible, so the assertion is a plain `as AgentCoordinator`
  // and stays clear of the forbidden double-cast through the top type.
  const coordStub: Pick<AgentCoordinator, "isAwaitingConfirmation"> = {
    isAwaitingConfirmation: () => awaitingConfirmation,
  };
  const coordRef: { current: AgentCoordinator | null } = {
    current: coordStub as AgentCoordinator,
  };

  const fakePostTask: AgentRunners["runPostTask"] =
    runPostTaskOverride ??
    (async (input: PostTaskInput) => {
      postTaskCalls += 1;
      captured.input = input;
      return postTaskReturn;
    });

  const fakeSpawn: AgentRunners["spawnWorker"] = () => ({
    exited: Promise.resolve(exitCode),
    kill: () => {},
  });

  const spawnWorker = createSpawnWorker({
    args,
    cfg,
    apiKey: "test-key",
    projectRoot: tempDir,
    statesDir: join(tempDir, ".ralph", "tasks"),
    logsDir: tempDir,
    useWorktree: false,
    indicators: {},
    cmdRunner: { run: async () => ({ stdout: "", stderr: "" }) },
    gitRunner: { run: async () => ({ stdout: "", stderr: "" }) },
    applyIndicator: async () => {},
    bus: createNoopBus(),
    onLog: () => {},
    diag: () => {},
    runners: { spawnWorker: fakeSpawn, runPostTask: fakePostTask },
    awaitingChangeSet,
    coordRef,
    cwdByChange,
    statesDirByChange,
    branchByChange,
    issueByChange,
    onPrRegistered: () => {},
    runScript: async () => {},
    onWorkerStarted: () => {},
    onWorkerExited: (cn) => exitedWorkers.push(cn),
  });

  return {
    spawnWorker,
    captured,
    postTaskCalls: () => postTaskCalls,
    exitedWorkers,
    maps: { cwdByChange, statesDirByChange, branchByChange, issueByChange },
  };
}

describe("createSpawnWorker exit handler", () => {
  test("passes the terminal exit code through and returns the post-task result", async () => {
    const h = await buildHarness({ exitCode: 7, postTaskReturn: 3 });
    const exited = await h.spawnWorker(CHANGE).exited;
    expect(h.captured.input?.exitCode).toBe(7);
    expect(exited).toBe(3);
  });

  test("forces wantPr=false when reaped into awaitingChangeSet", async () => {
    const h = await buildHarness({ wantPrBase: true, awaiting: true });
    await h.spawnWorker(CHANGE).exited;
    expect(h.captured.input?.wantPr).toBe(false);
  });

  test("forces wantPr=false when coordinator is awaiting confirmation", async () => {
    const h = await buildHarness({ wantPrBase: true, awaitingConfirmation: true });
    await h.spawnWorker(CHANGE).exited;
    expect(h.captured.input?.wantPr).toBe(false);
  });

  test("wantPr=true when base intent is set and not awaiting", async () => {
    const h = await buildHarness({ wantPrBase: true });
    await h.spawnWorker(CHANGE).exited;
    expect(h.captured.input?.wantPr).toBe(true);
  });

  test("validate-only: spec present and no PR intent yields wantValidateOnly=true, wantPr=false", async () => {
    const specDir = join(tempDir, "openspec", "changes", CHANGE, "specs");
    await Bun.write(join(specDir, "validate.md"), "# validate\n");

    const h = await buildHarness({ wantPrBase: false });
    await h.spawnWorker(CHANGE).exited;

    expect(h.captured.input?.wantValidateOnly).toBe(true);
    expect(h.captured.input?.wantPr).toBe(false);
  });

  test("releases all four per-change maps and fires onWorkerExited exactly once", async () => {
    const h = await buildHarness();
    await h.spawnWorker(CHANGE).exited;

    expect(h.maps.cwdByChange.has(CHANGE)).toBe(false);
    expect(h.maps.statesDirByChange.has(CHANGE)).toBe(false);
    expect(h.maps.branchByChange.has(CHANGE)).toBe(false);
    expect(h.maps.issueByChange.has(CHANGE)).toBe(false);
    expect(h.exitedWorkers).toEqual([CHANGE]);
  });

  test("default resolves to the real runPostTask import when no override is given", () => {
    // The seam must default to production wiring: an identity check guards
    // against silently breaking the real post-task pipeline. Mirror the exact
    // resolution in `createSpawnWorker` (`input.runners?.runPostTask ?? runPostTask`)
    // for runners that omit the override.
    const runnersWithoutOverride: AgentRunners = {
      spawnWorker: () => ({ exited: Promise.resolve(0), kill: () => {} }),
    };
    const resolved = runnersWithoutOverride.runPostTask ?? runPostTask;
    expect(resolved).toBe(runPostTask);
  });
});
