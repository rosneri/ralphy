import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import React from "react";
import { render } from "ink-testing-library";
import { emptyCommonArgs } from "@ralphy/cli-args";
import { WorkflowConfigSchema } from "@ralphy/workflow/schema";
import {
  AgentMode,
  type AgentModeBuildCoordinator,
  type AgentModeCoordinator,
} from "../components/AgentMode";
import type { AgentParsedArgs as ParsedArgs } from "../cli";
import type { RalphyConfig } from "../agent/config";
import type { TicketRow } from "../components/task-pipeline";

async function flush(ms = 150) {
  await new Promise((r) => setTimeout(r, ms));
}

const fakeConfig: RalphyConfig = {
  ...WorkflowConfigSchema.parse({}),
  engine: "claude",
  model: "sonnet",
};
const ensureConfigStub = async () => "/tmp/ralphy.json";
const loadConfigStub = async (): Promise<RalphyConfig> => fakeConfig;

const baseArgs: ParsedArgs = {
  ...emptyCommonArgs(),
  mode: "agent",
  name: "",
  linearTeam: "RLF",
  linearAssignee: "me",
  ticketTokens: [],
  pollInterval: 0,
  concurrency: 0,
  worktree: false,
  indicators: {},
  createPr: false,
  noTmux: false,
  stackPrs: false,
  codeReview: false,
  maxTickets: 0,
  jsonOutput: false,
  prompt: "",
  debug: false,
  agentDebug: false,
  checks: false,
  review: false,
};

// A gated ticket is surfaced by the coordinator as an `awaiting` board row —
// not a separate [GATE] card — so the builder seeds the board, mirroring what
// `Coordinator.buildBoard` does for awaiting-confirmation ids.
function makeBuilderWithAwaiting(awaitingRow?: {
  changeName: string;
  identifier: string;
  title: string;
  url: string;
}): AgentModeBuildCoordinator {
  return () => {
    const board = awaitingRow
      ? [
          {
            changeName: awaitingRow.changeName,
            id: awaitingRow.changeName,
            identifier: awaitingRow.identifier,
            title: awaitingRow.title,
            url: awaitingRow.url,
            priority: 0,
            state: "awaiting" as const,
          },
        ]
      : [];
    const coord: AgentModeCoordinator = {
      activeWorkers: [],
      activeCount: 0,
      queuedCount: 0,
      init: async () => {},
      pollOnce: async () => ({
        found: board.length,
        added: 0,
        buckets: {
          todo: 0,
          inProgress: 0,
          conflicted: 0,
          ciFailed: 0,
          review: 0,
          mentions: 0,
          quarantined: 0,
          awaiting: board.length,
        },
        prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0, quarantined: 0 },
        phase: {},
        flow: {},
        board,
      }),
      stop: () => {},
      getPause: () => null,
      restartWorker: async () => true,
    };
    return {
      coord,
      filterDesc: "fake",
      concurrency: 1,
      pollInterval: 60,
      getWorkerCwd: () => undefined,
      runBaselineGate: async () => {},
    };
  };
}

/** Seed an arbitrary board (and active-worker count) so the stall indicator —
 *  which keys off the board states plus live workers — can be exercised. */
function makeBuilderWithBoard(board: TicketRow[], activeWorkers = 0): AgentModeBuildCoordinator {
  return () => {
    const coord: AgentModeCoordinator = {
      activeWorkers: [],
      activeCount: activeWorkers,
      queuedCount: 0,
      init: async () => {},
      pollOnce: async () => ({
        found: board.length,
        added: 0,
        buckets: {
          todo: 0,
          inProgress: 0,
          conflicted: 0,
          ciFailed: 0,
          review: 0,
          mentions: 0,
          quarantined: 0,
          awaiting: 0,
        },
        prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0, quarantined: 0 },
        phase: {},
        flow: {},
        board,
      }),
      stop: () => {},
      getPause: () => null,
      restartWorker: async () => true,
    };
    return {
      coord,
      filterDesc: "fake",
      concurrency: 1,
      pollInterval: 60,
      getWorkerCwd: () => undefined,
      runBaselineGate: async () => {},
    };
  };
}

function boardRow(
  identifier: string,
  state: TicketRow["state"],
  blockedBy: string[] = [],
): TicketRow {
  return {
    changeName: identifier.toLowerCase(),
    id: identifier.toLowerCase(),
    identifier,
    title: `title ${identifier}`,
    url: `https://linear.app/x/${identifier}`,
    priority: 0,
    state,
    ...(blockedBy.length ? { blockedByIds: blockedBy, blockedByIdentifiers: blockedBy } : {}),
  };
}

function renderBoard(tmpRoot: string, build: AgentModeBuildCoordinator) {
  return render(
    React.createElement(AgentMode, {
      args: baseArgs,
      projectRoot: tmpRoot,
      statesDir: join(tmpRoot, "states"),
      tasksDir: join(tmpRoot, "tasks"),
      appendSteering: async () => {},
      buildCoordinator: build,
      ensureConfig: ensureConfigStub,
      loadConfig: loadConfigStub,
      runPreflight: async () => ({ ok: true as const }),
    }),
  );
}

describe("AgentMode awaiting-confirmation", () => {
  let tmpRoot: string;
  let savedKey: string | undefined;
  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-mode-awaiting-"));
    savedKey = process.env["LINEAR_API_KEY"];
    process.env["LINEAR_API_KEY"] = "fake";
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("renders a gated ticket inline as an awaiting board row, not a [GATE] card", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilderWithAwaiting({
          changeName: "rlf-78-foo",
          identifier: "RLF-78",
          title: "Confirmation gate test",
          url: "https://linear.app/x/issue/RLF-78",
        }),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush();
    const frame = stripVTControlCharacters(lastFrame() ?? "");
    // The ticket appears in the TASKS board with its awaiting status label …
    expect(frame).toContain("RLF-78");
    expect(frame).toContain("awaiting confirmation");
    // … and the standalone gate card is gone.
    expect(frame).not.toContain("[GATE");
    unmount();
  });

  test("shows a 'nothing can start' banner when every ticket is blocked or awaiting", async () => {
    const board = [
      boardRow("LIT-428", "todo", ["LIT-420"]), // blocked
      boardRow("LIT-431", "todo", ["LIT-428"]), // blocked
      boardRow("LIT-429", "awaiting"), // gated
    ];
    const { lastFrame, unmount } = renderBoard(tmpRoot, makeBuilderWithBoard(board));
    await flush();
    const frame = stripVTControlCharacters(lastFrame() ?? "");
    expect(frame).toContain("nothing can start");
    expect(frame).toContain("2 blocked");
    expect(frame).toContain("1 awaiting confirmation");
    unmount();
  });

  test("no stall banner while a ticket is actively working", async () => {
    const board = [
      boardRow("LIT-500", "working"),
      boardRow("LIT-431", "todo", ["LIT-500"]), // blocked, but work is advancing
    ];
    const { lastFrame, unmount } = renderBoard(tmpRoot, makeBuilderWithBoard(board, 1));
    await flush();
    const frame = stripVTControlCharacters(lastFrame() ?? "");
    expect(frame).not.toContain("nothing can start");
    unmount();
  });

  test("caps the board at 10 rows and lists the rest in a horizontal strip", async () => {
    const board = Array.from({ length: 13 }, (_, i) => boardRow(`LIT-${i + 1}`, "todo"));
    const { lastFrame, unmount } = renderBoard(tmpRoot, makeBuilderWithBoard(board));
    await flush();
    const frame = stripVTControlCharacters(lastFrame() ?? "");
    // First 10 tickets get full rows, 0-indexed ([0]..[9], never [10]).
    expect(frame).toContain("[0]");
    expect(frame).toContain("[9]");
    expect(frame).not.toContain("[10]");
    // The remaining 3 appear only in the horizontal "+N more" identifier strip.
    expect(frame).toContain("+3 more");
    expect(frame).toContain("LIT-11");
    expect(frame).toContain("LIT-13");
    unmount();
  });
});
