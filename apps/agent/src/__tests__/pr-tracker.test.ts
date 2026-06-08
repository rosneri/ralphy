import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrTracker, PR_TRACKER_STATE_RELPATH, readState } from "../features/pr-tracker";
import {
  AgentCoordinator,
  type CoordinatorDeps,
  type MentionTrigger,
  type PrStatusBucket,
  type QueueTrigger,
} from "../agent/coordinator";
import type { LinearIssue } from "../agent/linear";
import type { SetIndicator } from "@ralphy/types";

const NOW = () => new Date("2026-05-27T12:00:00.000Z");

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "ralphy-pr-tracker-"));
}

describe("PrTracker — state machine", () => {
  let root: string;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("first failure → demote, attempts=1", async () => {
    const t = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    const d = await t.recordFailure("ENG-1", "conflicting");
    expect(d).toEqual({ kind: "demote", attempts: 1 });
    expect(t.getAttempts("ENG-1")).toBe(1);
    expect(t.isBailed("ENG-1")).toBe(false);

    // state file flushed
    const persisted = await readState(root);
    expect(persisted["ENG-1"]).toMatchObject({ attempts: 1, lastReason: "conflicting" });
    expect(persisted["ENG-1"]!.bailed).toBeUndefined();
  });

  test("two failures below threshold → both demote, counter increments", async () => {
    const t = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    const d1 = await t.recordFailure("ENG-1", "conflicting");
    const d2 = await t.recordFailure("ENG-1", "ci_failed");
    expect(d1).toEqual({ kind: "demote", attempts: 1 });
    expect(d2).toEqual({ kind: "demote", attempts: 2 });
    expect(t.isBailed("ENG-1")).toBe(false);
  });

  test("threshold reached → first bail flagged, subsequent bails dedup", async () => {
    const t = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    await t.recordFailure("ENG-1", "conflicting");
    await t.recordFailure("ENG-1", "conflicting");
    const tipping = await t.recordFailure("ENG-1", "conflicting");
    expect(tipping).toEqual({ kind: "bail", attempts: 3, firstBail: true });
    expect(t.isBailed("ENG-1")).toBe(true);

    const again = await t.recordFailure("ENG-1", "conflicting");
    expect(again).toEqual({ kind: "bail", attempts: 3, firstBail: false });

    const persisted = await readState(root);
    expect(persisted["ENG-1"]!.bailed).toBe(true);
    expect(persisted["ENG-1"]!.attempts).toBe(3);
  });

  test("clear() removes entry; subsequent failure starts fresh", async () => {
    const t = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 2, now: NOW });
    await t.recordFailure("ENG-1", "conflicting");
    await t.clear("ENG-1");
    expect(t.getAttempts("ENG-1")).toBe(0);
    const d = await t.recordFailure("ENG-1", "ci_failed");
    expect(d).toEqual({ kind: "demote", attempts: 1 });

    const persisted = await readState(root);
    expect(persisted["ENG-1"]!.attempts).toBe(1);
  });

  test("clear() on unknown identifier is a no-op", async () => {
    const t = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    await t.clear("ENG-NOPE");
    expect(t.getAttempts("ENG-NOPE")).toBe(0);
  });

  test("load() rehydrates from a previous process", async () => {
    const t1 = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    await t1.recordFailure("ENG-1", "conflicting");
    await t1.recordFailure("ENG-1", "conflicting");

    const t2 = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    await t2.load();
    expect(t2.getAttempts("ENG-1")).toBe(2);
    expect(t2.isBailed("ENG-1")).toBe(false);
  });

  test("state file relpath is the documented one", () => {
    expect(PR_TRACKER_STATE_RELPATH).toBe(".ralph/pr-tracker-state.json");
  });

  test("missing state file resolves to empty", async () => {
    const state = await readState(freshRoot());
    expect(state).toEqual({});
  });

  test("corrupt JSON in state file resolves to empty (no throw)", async () => {
    const r = freshRoot();
    await Bun.write(join(r, PR_TRACKER_STATE_RELPATH), "{ this is not json");
    const state = await readState(r);
    expect(state).toEqual({});
  });

  test("non-object JSON (e.g. an array) in state file resolves to empty", async () => {
    const r = freshRoot();
    await Bun.write(join(r, PR_TRACKER_STATE_RELPATH), "[1,2,3]");
    const state = await readState(r);
    expect(state).toEqual({});
  });

  test("JSON null in state file resolves to empty", async () => {
    const r = freshRoot();
    await Bun.write(join(r, PR_TRACKER_STATE_RELPATH), "null");
    const state = await readState(r);
    expect(state).toEqual({});
  });
});

/* -------------------------------------------------------------------------- *
 * Coordinator integration: scanPrMergeStates routes through PrTracker.
 * Mirrors the conflict-fix / ci-fix matrix from RLF-173's spec.
 * -------------------------------------------------------------------------- */

function issue(id: string, identifier: string): LinearIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "In Review", type: "started" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

interface PrCtx {
  deps: CoordinatorDeps;
  applies: { id: string; ind: SetIndicator }[];
  comments: { id: string; body: string }[];
  prByIssue: Map<string, { url: string; status: PrStatusBucket } | null>;
  queueLogs: string[];
}

function makePrDeps(doneCandidates: LinearIssue[]): PrCtx {
  const applies: { id: string; ind: SetIndicator }[] = [];
  const comments: { id: string; body: string }[] = [];
  const prByIssue = new Map<string, { url: string; status: PrStatusBucket } | null>();
  const queueLogs: string[] = [];

  const deps: CoordinatorDeps = {
    fetchTodo: mock(async () => []),
    fetchInProgress: mock(async () => []),
    fetchMentions: mock(async () => [] as { issue: LinearIssue; trigger: MentionTrigger }[]),
    fetchDoneCandidates: mock(async () => doneCandidates),
    fetchReview: mock(async () => []),
    prepare: mock(async (i: LinearIssue) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
    prepareTaskForTrigger: mock(async (_i: LinearIssue, _n: string, _t: QueueTrigger) => {}),
    spawnWorker: mock(() => ({
      exited: new Promise<number>(() => {}),
      kill: () => {},
    })),
    applyIndicator: async (i, ind) => {
      applies.push({ id: i.identifier, ind });
    },
    removeIndicator: async () => {},
    postComment: async (i, body) => {
      comments.push({ id: i.identifier, body });
    },
    fetchComments: async () => [],
    checkPrStatus: async (i) => prByIssue.get(i.id) ?? null,
    onLog: (text) => {
      if (text.includes("conflict-fix") || text.includes("ci-fix") || text.includes("pr-tracker"))
        queueLogs.push(text);
    },
    onWorkersChanged: () => {},
  };
  return { deps, applies, comments, prByIssue, queueLogs };
}

const SET_ERROR: SetIndicator = { type: "label", value: "ralph:error" };
const SET_IN_PROGRESS: SetIndicator = { type: "status", value: "In Progress" };

describe("AgentCoordinator + PrTracker integration", () => {
  let root: string;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("CONFLICTING under threshold → queues conflict-fix and increments counter", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "conflicted" });
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0, // freeze worker spawns; we only care about the queue + tracker
      setInProgress: SET_IN_PROGRESS,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    await coord.pollOnce();
    expect(coord.queuedCount).toBe(1);
    expect(tracker.getAttempts("ENG-1")).toBe(1);
    expect(tracker.isBailed("ENG-1")).toBe(false);
    expect(ctx.applies.some((a) => a.ind === SET_ERROR)).toBe(false);
  });

  test("CONFLICTING at threshold → bails (setError + comment), no enqueue", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "conflicted" });
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 1, now: NOW });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    await coord.pollOnce();

    expect(coord.queuedCount).toBe(0);
    expect(tracker.isBailed("ENG-1")).toBe(true);
    expect(ctx.applies).toEqual([{ id: "ENG-1", ind: SET_ERROR }]);
    expect(ctx.comments).toHaveLength(1);
    expect(ctx.comments[0]!.body).toContain("gave up");
    expect(ctx.comments[0]!.body).toContain("merge conflicts");
  });

  test("CI failed at threshold → bails with ci-specific human reason", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    ctx.prByIssue.set("u1", { url: "https://gh/pr/2", status: "ci_failed" });
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 1, now: NOW });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    await coord.pollOnce();

    expect(coord.queuedCount).toBe(0);
    expect(ctx.applies).toEqual([{ id: "ENG-1", ind: SET_ERROR }]);
    expect(ctx.comments[0]!.body).toContain("failing CI");
  });

  test("post-bail subsequent ticks do NOT re-apply setError or re-comment", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "conflicted" });
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 1, now: NOW });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    await coord.pollOnce();
    // Reset the per-process conflictNotified dedup by re-instantiating
    // — actually it lives on the coordinator. Simulate the next tick.
    // (conflictNotified short-circuits before the tracker, so we just verify
    //  no extra writes here; on a fresh coordinator the tracker still bails-dedup.)
    const coord2 = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    // Poll 1 applied the setError label; on the next poll the issue carries it,
    // so the bail stays in effect (a cleared label is what releases it).
    i.labels = ["ralph:error"];
    ctx.applies.length = 0;
    ctx.comments.length = 0;
    await coord2.pollOnce();
    expect(ctx.applies).toEqual([]);
    expect(ctx.comments).toEqual([]);
  });

  test("MERGEABLE PR clears the recovery counter", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    // Pre-seed: pretend we previously detected one failure.
    await tracker.recordFailure("ENG-1", "conflicting");
    expect(tracker.getAttempts("ENG-1")).toBe(1);

    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "mergeable" });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    await coord.pollOnce();
    expect(tracker.getAttempts("ENG-1")).toBe(0);
  });

  test("UNKNOWN mergeability → no tracker write, no queue", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "unknown" });
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    await coord.pollOnce();
    expect(coord.queuedCount).toBe(0);
    expect(tracker.getAttempts("ENG-1")).toBe(0);
    expect(ctx.applies).toEqual([]);
  });

  test("RLF-97 bail-counter guard: UNKNOWN (pending CI) does NOT clear a mid-recovery counter", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    // A recovery session is already in flight: the counter sits at 1.
    await tracker.recordFailure("ENG-1", "ci_failed");
    expect(tracker.getAttempts("ENG-1")).toBe(1);

    // CI is mid-rerun, so checkPrStatus reports "unknown" (pending) — NOT
    // "mergeable". The bug was pending collapsing into "mergeable", which clears
    // the counter on every poll between re-runs so `maxRecoverySessions` never trips.
    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "unknown" });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    await coord.pollOnce();
    // The counter must survive — clearing it here is the bail-counter-defeat bug.
    expect(tracker.getAttempts("ENG-1")).toBe(1);
  });

  test("RLF-97 defect #1: prRecovery disabled → the merge-state scan is a no-op (off means off)", async () => {
    const i = issue("u1", "ENG-1");
    const ctx = makePrDeps([i]);
    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "conflicted" });
    // No prRecovery opt at all ≡ disabled. Previously the scan still queued a
    // conflict-fix (only the bail counter was gated); now nothing is queued.
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setError: SET_ERROR,
    });
    await coord.pollOnce();
    expect(coord.queuedCount).toBe(0);
    expect(ctx.applies).toEqual([]);
  });

  test("RLF-97: fixCi=false leaves a CI-failed PR alone but still recovers conflicts", async () => {
    const conflicting = issue("u1", "ENG-1");
    const ciRed = issue("u2", "ENG-2");
    const ctx = makePrDeps([conflicting, ciRed]);
    ctx.prByIssue.set("u1", { url: "https://gh/pr/1", status: "conflicted" });
    ctx.prByIssue.set("u2", { url: "https://gh/pr/2", status: "ci_failed" });
    const tracker = new PrTracker({ projectRoot: root, maxRecoveryAttempts: 3, now: NOW });
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      setInProgress: SET_IN_PROGRESS,
      setError: SET_ERROR,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: false, fixConflicts: true },
    });
    await coord.pollOnce();
    // Conflict recovery fires; CI recovery does not.
    expect(coord.queuedCount).toBe(1);
    expect(tracker.getAttempts("ENG-1")).toBe(1);
    expect(tracker.getAttempts("ENG-2")).toBe(0);
  });
});
