import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as nodeOs from "node:os";
import { join } from "node:path";
const { tmpdir } = nodeOs;

const FAKE_HOME = mkdtempSync(join(tmpdir(), "awaiting-home-"));
mock.module("node:os", () => ({
  ...nodeOs,
  homedir: () => FAKE_HOME,
}));
import { processAwaitingForIssue } from "../awaiting";
import { changeNameForIssue } from "../../../agent/scaffold";
import type { LinearIssue } from "../../../agent/linear";
import type { RalphyConfig } from "../../../agent/config";
import { WorkflowConfigSchema } from "@ralphy/workflow/schema";
import type { Indicators } from "@ralphy/types";

function makeIssue(): LinearIssue {
  return {
    id: "uuid-rlf-200",
    identifier: "RLF-200",
    title: "Confirmation respawn case",
    description: null,
    url: "https://linear.app/example/RLF-200",
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-05-20T00:00:00.000Z",
    blockedByIds: [],
  };
}

function makeConfig(): RalphyConfig {
  return WorkflowConfigSchema.parse({
    linear: {
      mentionHandle: "@ralphy",
      postComments: false,
      confirmationMode: {
        enabled: true,
        optOutLabel: "ralph:auto-approve",
        timeoutHours: 48,
        maxConfirmationRounds: 3,
      },
      indicators: {},
    },
  });
}

interface Captured {
  logs: string[];
  awaitingChangeSet: Set<string>;
  reaped: string[];
  awaitingTickets: number;
}

async function seedBugSnapshot(root: string, changeName: string): Promise<void> {
  const changeDir = join(root, "openspec", "changes", changeName);
  const stateDir = join(root, ".ralph", "tasks", changeName);
  await mkdir(changeDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await Bun.write(
    join(changeDir, "tasks.md"),
    "# Tasks\n\n## Implementation\n\n- [ ] do the thing\n",
  );
  await Bun.write(
    join(stateDir, ".ralph-state.json"),
    JSON.stringify(
      {
        confirmation: {
          askedAt: "2026-05-20T01:00:00.000Z",
          lastReminderAt: null,
          confirmedAt: null,
          rounds: 0,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

function makeDeps(
  worktree: string | (() => string),
  captured: Captured,
  overrides: Partial<{
    cwdOf: (cn: string) => string | undefined;
  }> = {},
): Parameters<typeof processAwaitingForIssue>[1] {
  const indicators: Indicators = {};
  return {
    cfg: makeConfig(),
    apiKey: "",
    projectRoot: typeof worktree === "string" ? worktree : "/unused",
    useWorktree: false,
    indicators,
    cwdOf: overrides.cwdOf ?? (() => (typeof worktree === "string" ? worktree : worktree())),
    awaitingChangeSet: captured.awaitingChangeSet,
    reapForAwaiting: (cn: string) => captured.reaped.push(cn),
    applyIndicator: async () => {},
    applyMarker: async () => {},
    onAwaitingTicket: () => {
      captured.awaitingTickets += 1;
    },
    onLog: (msg: string) => captured.logs.push(msg),
  };
}

describe("processAwaitingForIssue", () => {
  test("second-poll resume preserves the claim", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-resume-"));
    try {
      const issue = makeIssue();
      const changeName = changeNameForIssue(issue);
      await seedBugSnapshot(dir, changeName);

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const deps = makeDeps(dir, captured);

      const result = await processAwaitingForIssue(issue, deps);

      expect(result).toBe(true);
      expect(captured.awaitingChangeSet.has(changeName)).toBe(true);
      expect(captured.reaped).toContain(changeName);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("worktree dir uses short identifier even when change-name is the full slug", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-wtmismatch-"));
    try {
      const issue = makeIssue();
      const changeName = changeNameForIssue(issue);
      expect(changeName).not.toBe(issue.identifier.toLowerCase());
      const projectRoot = join(dir, "proj");
      await mkdir(projectRoot, { recursive: true });
      const wtDir = join(FAKE_HOME, ".ralph", "proj", "worktrees", issue.identifier.toLowerCase());
      await seedBugSnapshot(wtDir, changeName);

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const deps = makeDeps(projectRoot, captured, { cwdOf: () => undefined });
      deps.useWorktree = true;
      deps.projectRoot = projectRoot;

      const result = await processAwaitingForIssue(issue, deps);

      expect(captured.logs.some((l) => /tasks-empty/.test(l))).toBe(false);
      expect(result).toBe(true);
      expect(captured.awaitingChangeSet.has(changeName)).toBe(true);
      expect(captured.reaped).toContain(changeName);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throw inside detect preserves the claim", async () => {
    const issue = makeIssue();
    const captured: Captured = {
      logs: [],
      awaitingChangeSet: new Set<string>(),
      reaped: [],
      awaitingTickets: 0,
    };
    const deps = makeDeps("/unused", captured, {
      cwdOf: () => {
        throw new Error("boom");
      },
    });

    const result = await processAwaitingForIssue(issue, deps);

    expect(result).toBe(true);
    expect(captured.logs.some((l) => /confirmation detect threw for /.test(l))).toBe(true);
  });
});
