/**
 * RFC #402 — intentionally pinned behavior changes around restarts.
 *
 * The recovery-comment dedup lives on the persisted flow snapshot
 * (`recovery.*NotifiedAt`), not in process-lifetime Sets, so:
 *  1. after a restart, a still-red PR whose ticket already sits in a fix
 *     state does NOT re-post the detection comment — but DOES re-enqueue the
 *     fix worker (the old behavior posted a duplicate comment; before the
 *     re-enqueue guard the ticket could also strand with no worker at all);
 *  2. the quarantine give-up comment is once-only across restarts.
 */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TrackedIssue } from "@ralphy/tracker";
import { AgentCoordinator, type CoordinatorDeps } from "../agent/coordinator";

function issue(id: string, identifier: string): TrackedIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "Done", type: "completed" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "coordinator-restart-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Harness {
  coordinator: AgentCoordinator;
  comments: string[];
  spawns: { changeName: string; trigger: string }[];
}

/** A minimal coordinator whose only live ticket is a done-candidate with a
 *  red PR. Flow snapshots persist under `root/<issueId>` so a second harness
 *  over the same root behaves like a restarted process. */
function makeHarness(args: {
  candidate: TrackedIssue;
  prStatus: "conflicted" | "ci_failed";
  maxRecoverySessions?: number;
}): Harness {
  const comments: string[] = [];
  const spawns: { changeName: string; trigger: string }[] = [];
  const deps: CoordinatorDeps = {
    fetchTodo: mock(async () => []),
    fetchInProgress: mock(async () => []),
    fetchMentions: mock(async () => []),
    fetchReview: mock(async () => []),
    fetchDoneCandidates: mock(async () => [args.candidate]),
    fetchComments: async () => [],
    prepare: mock(async (i: TrackedIssue) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
    spawnWorker: mock((changeName: string, _issue: TrackedIssue, trigger) => {
      spawns.push({ changeName, trigger });
      // Never exits — the fix run stays in flight for the rest of the test.
      return { exited: new Promise<number>(() => {}), kill: () => {} };
    }),
    applyIndicator: async () => {},
    removeIndicator: async () => {},
    postComment: async (_i, body) => {
      comments.push(body);
    },
    checkPrStatus: async () => ({ url: "https://github.com/o/r/pull/42", status: args.prStatus }),
    getChangeDir: (i) => join(root, i.id),
    onLog: () => {},
    onWorkersChanged: () => {},
  };
  const coordinator = new AgentCoordinator(deps, {
    concurrency: 1,
    prRecovery: {
      enabled: true,
      fixCi: true,
      fixConflicts: true,
      maxRecoverySessions: args.maxRecoverySessions ?? 5,
    },
  });
  return { coordinator, comments, spawns };
}

describe("RFC #402 — restart-proof recovery dedup", () => {
  test("a still-red PR in a fix state re-enqueues after restart without re-posting the comment", async () => {
    const ticket = issue("i1", "ENG-1");
    await mkdir(join(root, ticket.id), { recursive: true });

    const first = makeHarness({ candidate: ticket, prStatus: "conflicted" });
    await first.coordinator.pollOnce();
    await first.coordinator.whenSettled();
    expect(first.comments.filter((c) => c.includes("merge conflicts")).length).toBe(1);
    expect(first.spawns).toEqual([{ changeName: "change-eng-1", trigger: "conflict-fix" }]);
    first.coordinator.stop();

    // Restart: a fresh process rehydrates the fix state from disk. The old
    // Sets-based dedup was empty here and re-posted the conflict comment.
    const second = makeHarness({ candidate: ticket, prStatus: "conflicted" });
    const result = await second.coordinator.pollOnce();
    await second.coordinator.whenSettled();
    expect(second.comments.filter((c) => c.includes("merge conflicts")).length).toBe(0);
    // …and the fix worker is re-enqueued instead of stranding the ticket.
    expect(second.spawns).toEqual([{ changeName: "change-eng-1", trigger: "conflict-fix" }]);
    expect(result.prStatus.conflicted).toBe(1);
    second.coordinator.stop();
  });

  test("ci-fix mirrors the conflict path across restarts", async () => {
    const ticket = issue("i2", "ENG-2");
    await mkdir(join(root, ticket.id), { recursive: true });

    const first = makeHarness({ candidate: ticket, prStatus: "ci_failed" });
    await first.coordinator.pollOnce();
    await first.coordinator.whenSettled();
    expect(first.comments.filter((c) => c.includes("failing CI")).length).toBe(1);
    first.coordinator.stop();

    const second = makeHarness({ candidate: ticket, prStatus: "ci_failed" });
    await second.coordinator.pollOnce();
    await second.coordinator.whenSettled();
    expect(second.comments.filter((c) => c.includes("failing CI")).length).toBe(0);
    expect(second.spawns).toEqual([{ changeName: "change-eng-2", trigger: "ci-fix" }]);
    second.coordinator.stop();
  });

  test("the quarantine give-up comment posts exactly once across restarts", async () => {
    const ticket = issue("i3", "ENG-3");
    await mkdir(join(root, ticket.id), { recursive: true });

    // Threshold 1: the very first detection tips straight into quarantine.
    const first = makeHarness({
      candidate: ticket,
      prStatus: "conflicted",
      maxRecoverySessions: 1,
    });
    const r1 = await first.coordinator.pollOnce();
    await first.coordinator.whenSettled();
    expect(r1.prStatus.quarantined).toBe(1);
    expect(first.comments.filter((c) => c.includes("Gave up auto-recovering")).length).toBe(1);
    expect(first.spawns.length).toBe(0);
    first.coordinator.stop();

    const second = makeHarness({
      candidate: ticket,
      prStatus: "conflicted",
      maxRecoverySessions: 1,
    });
    const r2 = await second.coordinator.pollOnce();
    await second.coordinator.whenSettled();
    expect(r2.prStatus.quarantined).toBe(1);
    expect(second.comments.filter((c) => c.includes("Gave up auto-recovering")).length).toBe(0);
    expect(second.spawns.length).toBe(0);
    second.coordinator.stop();
  });
});
