import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import React from "react";
import { render } from "ink-testing-library";
import { initialCommonArgs } from "@ralphy/cli-args";
import { WorkflowConfigSchema } from "@ralphy/workflow/schema";
import {
  AgentMode,
  type AgentModeBuildCoordinator,
  type AgentModeCoordinator,
} from "../components/AgentMode";
import type { AgentParsedArgs as ParsedArgs } from "../cli";
import type { RalphyConfig } from "../agent/config";

async function flush(ms = 150) {
  await new Promise((r) => setTimeout(r, ms));
}

/** A board with no live worker — a parked, quarantined ticket. This is the
 *  §0 motivating scenario: 0 active workers, a ticket parked on a failing PR. */
function makeParkedCoord(): AgentModeCoordinator {
  return {
    activeWorkers: [],
    activeCount: 0,
    queuedCount: 0,
    init: async () => {},
    pollOnce: async () => ({
      found: 1,
      added: 0,
      buckets: {
        todo: 0,
        inProgress: 1,
        conflicted: 0,
        ciFailed: 0,
        review: 0,
        mentions: 0,
        quarantined: 1,
        awaiting: 0,
      },
      prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0, quarantined: 1 },
      phase: {},
      flow: {},
      board: [
        {
          changeName: "ban-799",
          id: "issue-799",
          identifier: "BAN-799",
          title: "Parked on a red PR",
          url: "https://linear.app/x/issue/BAN-799",
          prUrl: "https://github.com/x/y/pull/18212",
          priority: 3,
          state: "quarantined" as const,
          recovery: {
            attempts: 3,
            lastReason: "ci_failed" as const,
            bailed: true,
            firstFailedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
        },
      ],
    }),
    stop: () => {},
    getPause: () => null,
    restartWorker: async () => true,
  };
}

function makeBuilder(coord: AgentModeCoordinator): AgentModeBuildCoordinator {
  return () => ({
    coord,
    filterDesc: "fake",
    concurrency: 1,
    pollInterval: 999,
    getWorkerCwd: () => undefined,
    runBaselineGate: async () => {},
  });
}

/** A two-row, all-parked board for exercising focus-by-id navigation. The
 *  board rows carry distinct titles which appear ONLY in the focused (box 4)
 *  card, so the title in the frame tells us which row is focused. */
function makeTwoParkedCoord(): AgentModeCoordinator {
  const board = [
    {
      changeName: "ban-100",
      id: "issue-100",
      identifier: "BAN-100",
      title: "First parked card",
      url: "https://linear.app/x/issue/BAN-100",
      priority: 3,
      state: "ci-fix" as const,
      recovery: {
        attempts: 1,
        lastReason: "ci_failed" as const,
        bailed: false,
        firstFailedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    },
    {
      changeName: "ban-200",
      id: "issue-200",
      identifier: "BAN-200",
      title: "Second parked card",
      url: "https://linear.app/x/issue/BAN-200",
      priority: 3,
      state: "quarantined" as const,
      recovery: {
        attempts: 3,
        lastReason: "ci_failed" as const,
        bailed: true,
        firstFailedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    },
  ];
  return {
    activeWorkers: [],
    activeCount: 0,
    queuedCount: 0,
    init: async () => {},
    pollOnce: async () => ({
      found: 2,
      added: 0,
      buckets: {
        todo: 0,
        inProgress: 2,
        conflicted: 0,
        ciFailed: 0,
        review: 0,
        mentions: 0,
        quarantined: 1,
        awaiting: 0,
      },
      prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0, quarantined: 1 },
      phase: {},
      flow: {},
      board,
    }),
    stop: () => {},
    getPause: () => null,
    restartWorker: async () => true,
  };
}

const fakeConfig: RalphyConfig = {
  ...WorkflowConfigSchema.parse({}),
  engine: "claude",
  model: "sonnet",
};
const ensureConfigStub = async () => "/tmp/ralphy.json";
const loadConfigStub = async (): Promise<RalphyConfig> => fakeConfig;

const baseArgs: ParsedArgs = {
  ...initialCommonArgs(),
  mode: "agent",
  name: "",
  linearTeam: "RLF",
  linearAssignee: "me",
  ticketTokens: [],
  pollInterval: 999,
  concurrency: 1,
  worktree: false,
  indicators: {},
  createPr: false,
  noTmux: false,
  stackPrs: false,
  codeReview: false,
  maxTickets: 0,
  jsonOutput: false,
  prompt: "",
  manualTest: false,
  debug: false,
  agentDebug: false,
  checks: false,
  review: false,
};

describe("AgentMode parked ticket (no live worker)", () => {
  let tmpRoot: string;
  let savedKey: string | undefined;
  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-mode-parked-"));
    savedKey = process.env["LINEAR_API_KEY"];
    process.env["LINEAR_API_KEY"] = "fake";
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("renders the parked read-only card — pipeline/state/PR, no CMD/OUTPUT/steering", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilder(makeParkedCoord()),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush();
    const frame = stripVTControlCharacters(lastFrame() ?? "");

    // The ticket and its parked detail are visible.
    expect(frame).toContain("BAN-799");
    expect(frame).toContain("quarantined");
    expect(frame).toContain("parked");
    expect(frame).toContain("#18212");

    // No live-worker affordances — the focused row is parked.
    expect(frame).not.toContain("CTRL+S to steer");
    expect(frame).not.toContain("OUTPUT");
    unmount();
  });

  test("Tab cycles focus by id over the board; box 4 swaps to the newly focused row", async () => {
    const { lastFrame, stdin, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilder(makeTwoParkedCoord()),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush();
    // Focus defaults to the first row → box 4 shows its title only.
    const initial = stripVTControlCharacters(lastFrame() ?? "");
    expect(initial).toContain("First parked card");
    expect(initial).not.toContain("Second parked card");

    // Tab advances focus to the second row → box 4 swaps.
    stdin.write("\t");
    await flush(60);
    const afterTab = stripVTControlCharacters(lastFrame() ?? "");
    expect(afterTab).toContain("Second parked card");
    expect(afterTab).not.toContain("First parked card");
    unmount();
  });
});
