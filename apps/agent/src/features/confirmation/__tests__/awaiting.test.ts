import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
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
import * as linear from "../../../agent/linear";
import type { RalphyConfig } from "../../../agent/config";
import { WorkflowConfigSchema } from "@ralphy/workflow/schema";
import type { Indicators, SetIndicator } from "@ralphy/types";

const commentBodies: string[] = [];
const reactedComments: Array<{ id: string; emoji: string }> = [];

// Use spyOn (restorable) instead of mock.module so these stubs don't leak
// into other test files that run in the same Bun worker process.
beforeAll(() => {
  spyOn(linear, "addIssueComment").mockImplementation(
    async (_apiKey: string, _id: string, body: string) => {
      commentBodies.push(body);
    },
  );
  spyOn(linear, "addReactionToComment").mockImplementation(
    async (_apiKey: string, id: string, emoji: string) => {
      reactedComments.push({ id, emoji });
    },
  );
  spyOn(linear, "fetchIssueComments").mockImplementation(async () => []);
});

afterAll(() => {
  mock.restore();
});

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
    "# Tasks\n\n## Planning\n\n- [x] research done\n\n## Implementation\n\n- [ ] do the thing\n",
  );
  await Bun.write(
    join(changeDir, "proposal.md"),
    "# Proposal\n\n## Why\n\nThis is why we need this change.\n\n## What Changes\n\n- Do the thing\n",
  );
  await Bun.write(
    join(changeDir, "design.md"),
    "# Design\n\nWe will implement the thing by modifying the relevant module.\n",
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

// Restore module mocks after all tests so they don't leak into other test
// files running in the same worker (mock.module on agent/linear resolves to
// linear-client through Bun's re-export deduplication).
afterAll(() => {
  mock.restore();
});

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

  test("setAwaitingConfirmation fires once across multiple polls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-setmarker-"));
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
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      deps.indicators = {
        setAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      await processAwaitingForIssue(issue, deps);
      await processAwaitingForIssue(issue, deps);
      await processAwaitingForIssue(issue, deps);
      expect(applied.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("clearAwaitingConfirmation fires on gate-cleared release", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-clear-gate-"));
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
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      deps.indicators = {
        setAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
        clearAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      // Poll 1 — gate active, marker applied.
      await processAwaitingForIssue(issue, deps);
      // Bypass gate via getAutoApprove indicator → gate clears next poll.
      deps.cfg.linear.indicators.getAutoApprove = {
        filter: [{ type: "label", value: "ralph:auto-approve" }],
      };
      issue.labels = ["ralph:auto-approve"];
      await processAwaitingForIssue(issue, deps);
      expect(applied.length).toBe(2);
      expect(applied[1]).toEqual({ type: "label", value: "ralph:awaiting-confirmation" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("clearAwaitingConfirmation fires on tasks-empty release", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-clear-tasks-"));
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
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      deps.indicators = {
        setAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
        clearAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      await processAwaitingForIssue(issue, deps);
      // Tasks file emptied.
      await Bun.write(
        join(dir, "openspec", "changes", changeName, "tasks.md"),
        "# Tasks\n\n_done_\n",
      );
      await processAwaitingForIssue(issue, deps);
      expect(applied.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("clearAwaitingConfirmation fires on stub-artifact release", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-clear-stub-"));
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
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      deps.indicators = {
        setAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
        clearAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      await processAwaitingForIssue(issue, deps);
      // Restub design.md so isStubArtifact returns true.
      await Bun.write(
        join(dir, "openspec", "changes", changeName, "design.md"),
        `# Design for ${changeName}\n\n_Fill in the technical design as you work through the issue._\n`,
      );
      await processAwaitingForIssue(issue, deps);
      expect(applied.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("clearAwaitingConfirmation fires on approve outcome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-clear-approve-"));
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
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      deps.indicators = {
        setAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
        clearAwaitingConfirmation: { type: "label", value: "ralph:awaiting-confirmation" },
        getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
        clearApproved: { type: "label", value: "ralph:approved" },
      };
      deps.cfg = {
        ...deps.cfg,
        linear: {
          ...deps.cfg.linear,
          indicators: deps.indicators,
        },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      // First poll: gate active, marker applied.
      await processAwaitingForIssue(issue, deps);
      // Second poll: ticket now has approval label → approved outcome.
      issue.labels = ["ralph:approved"];
      await processAwaitingForIssue(issue, deps);
      // Expect at least one clearAwaitingConfirmation indicator applied.
      const clears = applied.filter(
        (a) => !Array.isArray(a) && a.type === "label" && a.value === "ralph:awaiting-confirmation",
      );
      expect(clears.length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("setInProgress is re-applied on approve when awaiting marker is a status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-restore-inprogress-"));
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
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      // Awaiting marker is a STATUS (Design Review). clearAwaitingConfirmation
      // cannot undo a status, so the gate release must re-assert setInProgress
      // to pull the ticket back out of Design Review.
      deps.indicators = {
        setAwaitingConfirmation: { type: "status", value: "Design Review" },
        setInProgress: { type: "status", value: "In Progress" },
        getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
        clearApproved: { type: "label", value: "ralph:approved" },
      };
      deps.cfg = {
        ...deps.cfg,
        linear: {
          ...deps.cfg.linear,
          indicators: deps.indicators,
        },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      // Poll 1: gate active → Design Review status applied.
      await processAwaitingForIssue(issue, deps);
      // Poll 2: approval label present → approved outcome releases the gate.
      issue.labels = ["ralph:approved"];
      await processAwaitingForIssue(issue, deps);

      const setDesignReview = applied.filter(
        (a) => !Array.isArray(a) && a.type === "status" && a.value === "Design Review",
      );
      const restoreInProgress = applied.filter(
        (a) => !Array.isArray(a) && a.type === "status" && a.value === "In Progress",
      );
      expect(setDesignReview.length).toBe(1);
      expect(restoreInProgress.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // bug_case: documents the CURRENT (broken) behavior — approval across a
  // restart leaves the ticket stranded in the park status because
  // `releaseAwaitingMarker` early-returns on the missing local stamp.
  // Flipped to the fixed assertion (>= 1) after the production fix lands.
  test("setInProgress IS re-applied on approve when parked-by-status without a local stamp (regression guard)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-restart-bug-"));
    try {
      const issue = makeIssue();
      issue.state = { name: "Design Review", type: "started" };
      issue.labels = ["ralph:approved"];
      const changeName = changeNameForIssue(issue);
      await seedBugSnapshot(dir, changeName); // no awaitingMarkerAppliedAt

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      deps.indicators = {
        setAwaitingConfirmation: { type: "status", value: "Design Review" },
        setInProgress: { type: "status", value: "In Progress" },
        getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
        clearApproved: { type: "label", value: "ralph:approved" },
      };
      deps.cfg = {
        ...deps.cfg,
        linear: { ...deps.cfg.linear, indicators: deps.indicators },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      await processAwaitingForIssue(issue, deps);

      const restoreInProgress = applied.filter(
        (a) => !Array.isArray(a) && a.type === "status" && a.value === "In Progress",
      );
      // Post-fix: the gate release restores In Progress even with no local
      // stamp. (Before the fix this was 0 — the ticket stranded in the status.)
      expect(restoreInProgress.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Regression: a ticket parked in a *status* (e.g. "Planned"/"Design Review")
  // and approved across an agent restart. The park status persists on Linear,
  // but `awaitingMarkerAppliedAt` was stamped in the *previous* process, so this
  // process's state file has no stamp. Approval must still pull the ticket back
  // to In Progress — keyed off the issue's current status, not the local stamp.
  test("setInProgress is re-applied on approve when parked-by-status without a local marker stamp (restart)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-restart-restore-"));
    try {
      const issue = makeIssue();
      // Simulate the restart: the ticket is already sitting in the park status
      // on Linear, with the approval label freshly added.
      issue.state = { name: "Design Review", type: "started" };
      issue.labels = ["ralph:approved"];
      const changeName = changeNameForIssue(issue);
      await seedBugSnapshot(dir, changeName); // state file has NO awaitingMarkerAppliedAt

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const applied: SetIndicator[] = [];
      const deps = makeDeps(dir, captured);
      deps.indicators = {
        setAwaitingConfirmation: { type: "status", value: "Design Review" },
        setInProgress: { type: "status", value: "In Progress" },
        getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
        clearApproved: { type: "label", value: "ralph:approved" },
      };
      deps.cfg = {
        ...deps.cfg,
        linear: { ...deps.cfg.linear, indicators: deps.indicators },
      };
      deps.applyIndicator = async (_issue, ind) => {
        applied.push(ind);
      };

      // Single poll: approval already present, no prior parking poll in this
      // process → no `awaitingMarkerAppliedAt` stamp.
      await processAwaitingForIssue(issue, deps);

      const restoreInProgress = applied.filter(
        (a) => !Array.isArray(a) && a.type === "status" && a.value === "In Progress",
      );
      // fix_case: the gate release must restore In Progress even without a stamp.
      expect(restoreInProgress.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prDraft: opens the early draft PR exactly once when the gate parks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-early-pr-"));
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
      deps.cfg = { ...deps.cfg, prDraft: true };
      const openCalls: Array<{ changeName: string; cwd: string }> = [];
      deps.openDraftPr = async (_issue, cn, cwd) => {
        openCalls.push({ changeName: cn, cwd });
        return "https://github.com/owner/repo/pull/900";
      };

      // Poll 1: gate active + design ready → early draft PR opened.
      await processAwaitingForIssue(issue, deps);
      // Poll 2: earlyDraftPrAt stamp set → not re-opened.
      await processAwaitingForIssue(issue, deps);

      expect(openCalls.length).toBe(1);
      expect(openCalls[0]!.changeName).toBe(changeName);
      expect(openCalls[0]!.cwd).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Seed a gate-ready change WITHOUT a pre-existing askedAt so the plan-ready
  // comment path actually posts. Mirrors seedBugSnapshot minus the stamp.
  async function seedGateReadyNoAskedAt(root: string, changeName: string): Promise<void> {
    const changeDir = join(root, "openspec", "changes", changeName);
    const stateDir = join(root, ".ralph", "tasks", changeName);
    await mkdir(changeDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await Bun.write(
      join(changeDir, "tasks.md"),
      "# Tasks\n\n## Planning\n\n- [x] research done\n\n## Implementation\n\n- [ ] do the thing\n",
    );
    await Bun.write(
      join(changeDir, "proposal.md"),
      "# Proposal\n\n## Why\n\nThis is why we need this change.\n\n## What Changes\n\n- Do the thing\n",
    );
    await Bun.write(
      join(changeDir, "design.md"),
      "# Design\n\nWe will implement the thing by modifying the relevant module.\n",
    );
  }

  test("bug_case: prDraft stamp must NOT clobber askedAt (regression: double plan-ready post)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-double-post-"));
    try {
      const issue = makeIssue();
      const changeName = changeNameForIssue(issue);
      await seedGateReadyNoAskedAt(dir, changeName);

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const deps = makeDeps(dir, captured);
      deps.apiKey = "test-key";
      deps.cfg = {
        ...deps.cfg,
        prDraft: true,
        linear: { ...deps.cfg.linear, postComments: true, indicators: {} },
      };
      // Nothing to PR yet (design not committed) — the LIT-387 shape. The
      // stamp is still persisted so we don't retry every poll.
      deps.openDraftPr = async () => null;

      commentBodies.length = 0;
      await processAwaitingForIssue(issue, deps);
      await processAwaitingForIssue(issue, deps);

      const planPosts = commentBodies.filter((b) => b.includes("📋 Ralphy plan ready"));
      // Regression guard: openDraftPrOnce used to persist a stale confirmation
      // object (askedAt: null) right after postPlanReadyCommentOnce stamped
      // askedAt, making the second poll post the identical comment again.
      expect(planPosts.length).not.toBe(2);
      expect(planPosts.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fix_case: prDraft on — plan-ready comment posts exactly once across polls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-single-post-"));
    try {
      const issue = makeIssue();
      const changeName = changeNameForIssue(issue);
      await seedGateReadyNoAskedAt(dir, changeName);

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const deps = makeDeps(dir, captured);
      deps.apiKey = "test-key";
      deps.cfg = {
        ...deps.cfg,
        prDraft: true,
        linear: { ...deps.cfg.linear, postComments: true, indicators: {} },
      };
      deps.openDraftPr = async () => null;

      commentBodies.length = 0;
      await processAwaitingForIssue(issue, deps);
      await processAwaitingForIssue(issue, deps);

      const planPosts = commentBodies.filter((b) => b.includes("📋 Ralphy plan ready"));
      expect(planPosts.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prDraft off: never opens an early draft PR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-no-early-pr-"));
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
      const deps = makeDeps(dir, captured); // cfg.prDraft defaults to false
      let opened = 0;
      deps.openDraftPr = async () => {
        opened += 1;
        return null;
      };

      await processAwaitingForIssue(issue, deps);

      expect(opened).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("comment-type getApproved releases the gate when a human comment matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-comment-approve-"));
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
      deps.apiKey = "test-key";
      deps.cfg = {
        ...deps.cfg,
        linear: {
          ...deps.cfg.linear,
          indicators: { getApproved: { filter: [{ type: "comment", value: "approve" }] } },
        },
      };
      const fetchSpy = spyOn(linear, "fetchIssueComments").mockResolvedValue([
        {
          id: "c1",
          body: "LGTM, I approve this plan",
          createdAt: "2026-05-20T02:00:00.000Z",
          user: { name: "Human", email: null },
        },
      ]);

      // approved via comment → gate releases (returns false = not awaiting).
      const result = await processAwaitingForIssue(issue, deps);
      expect(result).toBe(false);
      fetchSpy.mockResolvedValue([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Ralphy's own reminder comment does not self-approve a comment-type getApproved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-comment-self-"));
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
      deps.apiKey = "test-key";
      deps.cfg = {
        ...deps.cfg,
        linear: {
          ...deps.cfg.linear,
          indicators: { getApproved: { filter: [{ type: "comment", value: "approve" }] } },
        },
      };
      // Ralphy's own reminder contains the word "Approve" — must be ignored.
      const fetchSpy = spyOn(linear, "fetchIssueComments").mockResolvedValue([
        {
          id: "r1",
          body: "⏰ Ralphy: still awaiting confirmation on this plan — approve to continue.",
          createdAt: "2026-05-20T02:00:00.000Z",
          user: null,
        },
      ]);

      const result = await processAwaitingForIssue(issue, deps);
      expect(result).toBe(true); // self-comment ignored → stays awaiting
      fetchSpy.mockResolvedValue([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan-ready comment body includes configured marker AND revise syntax", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-comment-"));
    try {
      const issue = makeIssue();
      const changeName = changeNameForIssue(issue);
      // Seed without askedAt so postPlanReadyCommentOnce actually posts.
      const changeDir = join(dir, "openspec", "changes", changeName);
      const stateDir = join(dir, ".ralph", "tasks", changeName);
      await mkdir(changeDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await Bun.write(
        join(changeDir, "tasks.md"),
        "# Tasks\n\n## Planning\n\n- [x] research done\n\n## Implementation\n\n- [ ] do the thing\n",
      );
      await Bun.write(
        join(changeDir, "proposal.md"),
        "# Proposal\n\n## Why\n\nyes.\n\n## What Changes\n\n- do\n",
      );
      await Bun.write(
        join(changeDir, "design.md"),
        "# Design\n\nWe will do the thing in a sufficiently-long sentence.\n",
      );

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const deps = makeDeps(dir, captured);
      deps.apiKey = "test-key";
      deps.cfg = {
        ...deps.cfg,
        linear: {
          ...deps.cfg.linear,
          postComments: true,
          indicators: {
            getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
          },
        },
      };

      commentBodies.length = 0;
      await processAwaitingForIssue(issue, deps);
      const planBody = commentBodies.find((b) => b.includes("📋 Ralphy plan ready"));
      expect(planBody).toBeDefined();
      expect(planBody!).toContain("ralph:approved");
      expect(planBody!).toContain("@ralphy revise:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan-ready comment falls back to generic sentence when getApproved is unset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-comment-fallback-"));
    try {
      const issue = makeIssue();
      const changeName = changeNameForIssue(issue);
      const changeDir = join(dir, "openspec", "changes", changeName);
      const stateDir = join(dir, ".ralph", "tasks", changeName);
      await mkdir(changeDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await Bun.write(
        join(changeDir, "tasks.md"),
        "# Tasks\n\n## Planning\n\n- [x] research done\n\n## Implementation\n\n- [ ] do the thing\n",
      );
      await Bun.write(
        join(changeDir, "proposal.md"),
        "# Proposal\n\n## Why\n\nyes.\n\n## What Changes\n\n- do\n",
      );
      await Bun.write(
        join(changeDir, "design.md"),
        "# Design\n\nWe will do the thing in a sufficiently-long sentence.\n",
      );

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const deps = makeDeps(dir, captured);
      deps.apiKey = "test-key";
      deps.cfg = {
        ...deps.cfg,
        linear: { ...deps.cfg.linear, postComments: true, indicators: {} },
      };

      commentBodies.length = 0;
      await processAwaitingForIssue(issue, deps);
      const planBody = commentBodies.find((b) => b.includes("📋 Ralphy plan ready"));
      expect(planBody).toBeDefined();
      expect(planBody!).toContain("ask your operator to approve");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("releases when Planning section has unchecked items", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awaiting-planning-incomplete-"));
    try {
      const issue = makeIssue();
      const changeName = changeNameForIssue(issue);
      const changeDir = join(dir, "openspec", "changes", changeName);
      const stateDir = join(dir, ".ralph", "tasks", changeName);
      await mkdir(changeDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      // Planning section still has unchecked items — AI hasn't finished planning yet.
      await Bun.write(
        join(changeDir, "tasks.md"),
        "# Tasks\n\n## Planning\n\n- [x] first\n- [ ] still todo\n\n## Implementation\n\n- [ ] do the thing\n",
      );
      await Bun.write(
        join(changeDir, "proposal.md"),
        "# Proposal\n\n## Why\n\nThis is why.\n\n## What Changes\n\n- Do it\n",
      );
      await Bun.write(join(changeDir, "design.md"), "# Design\n\nTechnical approach goes here.\n");
      await Bun.write(join(stateDir, ".ralph-state.json"), "{}\n");

      const captured: Captured = {
        logs: [],
        awaitingChangeSet: new Set<string>(),
        reaped: [],
        awaitingTickets: 0,
      };
      const result = await processAwaitingForIssue(issue, makeDeps(dir, captured));

      expect(result).toBe(false);
      expect(captured.logs.some((l) => /planning-incomplete/.test(l))).toBe(true);
      expect(captured.awaitingChangeSet.has(changeName)).toBe(false);
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
