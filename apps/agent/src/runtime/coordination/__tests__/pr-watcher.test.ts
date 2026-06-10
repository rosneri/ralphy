/**
 * RFC #402 — PrWatcher boundary tests: scripted PR statuses in, effects out.
 * Runs the real flow machine + FlowActorStore + FlowDirector (never mocked);
 * no tracker fake is needed because all tracker writes come back as data.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createNoopBus } from "@ralphy/events";
import { FlowActorStore, FlowDirector } from "@ralphy/core/machines";
import type { TrackedIssue } from "@ralphy/tracker";
import { PrWatcher, type PrStatusBucket } from "../pr-watcher";

function issue(id: string): TrackedIssue {
  return {
    id,
    identifier: id.toUpperCase(),
    title: `Issue ${id}`,
    description: null,
    url: `https://example/${id}`,
    state: { name: "Done", type: "completed" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

const NO_SKIPS = { skipIds: new Set<string>(), preexistingFix: { conflicted: 0, ciFailed: 0 } };

interface Harness {
  watcher: PrWatcher;
  director: FlowDirector;
  setPr: (id: string, status: PrStatusBucket | null) => void;
  setCandidates: (issues: TrackedIssue[]) => void;
  setDoneIds: Set<string>;
  errorClearedIds: Set<string>;
  logs: string[];
}

function makeHarness(
  recovery: { enabled: boolean; fixCi: boolean; fixConflicts: boolean } | undefined,
  maxRecoveryAttempts = 5,
): Harness {
  const store = new FlowActorStore({
    bus: createNoopBus(),
    persist: () => {},
    maxRecoveryAttempts,
  });
  const director = new FlowDirector(store);
  const prById = new Map<string, PrStatusBucket | null>();
  let candidates: TrackedIssue[] = [];
  const setDoneIds = new Set<string>();
  const errorClearedIds = new Set<string>();
  const logs: string[] = [];
  const watcher = new PrWatcher(
    {
      fetchDoneCandidates: async () => candidates,
      checkPrStatus: async (i) => {
        const status = prById.get(i.id) ?? null;
        return status === null
          ? null
          : { url: `https://github.com/o/r/pull/1${i.id.length}`, status };
      },
      director,
      flowRef: (i) => ({ key: i.id }),
      issueInSetDoneState: (i) => setDoneIds.has(i.id),
      errorMarkerCleared: (i) => errorClearedIds.has(i.id),
      onLog: (text) => logs.push(text),
    },
    recovery,
  );
  return {
    watcher,
    director,
    setPr: (id, status) => prById.set(id, status),
    setCandidates: (issues) => {
      candidates = issues;
    },
    setDoneIds,
    errorClearedIds,
    logs,
  };
}

let h: Harness;

beforeEach(() => {
  h = makeHarness({ enabled: true, fixCi: true, fixConflicts: true });
});

describe("PrWatcher.scan — gates and skips", () => {
  test("recovery disabled → no-op scan", async () => {
    h = makeHarness({ enabled: false, fixCi: true, fixConflicts: true });
    h.setCandidates([issue("a")]);
    h.setPr("a", "conflicted");
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([]);
    expect(result.prByIssue.size).toBe(0);
  });

  test("skipIds (active/pending/queued tickets) are left alone", async () => {
    h.setCandidates([issue("a")]);
    h.setPr("a", "conflicted");
    const result = await h.watcher.scan({ ...NO_SKIPS, skipIds: new Set(["a"]) });
    expect(result.effects).toEqual([]);
  });

  test("fixConflicts off leaves a conflicted PR alone but still reports its URL", async () => {
    h = makeHarness({ enabled: true, fixCi: true, fixConflicts: false });
    h.setCandidates([issue("a")]);
    h.setPr("a", "conflicted");
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([]);
    expect(result.counts.conflicted).toBe(0);
    expect(result.prByIssue.get("a")?.status).toBe("conflicted");
  });

  test("preexisting fix items are added to the standing-level counters", async () => {
    const result = await h.watcher.scan({
      skipIds: new Set(),
      preexistingFix: { conflicted: 2, ciFailed: 1 },
    });
    // No candidates at all — counters still reflect in-flight fix work.
    expect(result.counts.conflicted).toBe(0); // empty candidates → early return
    h.setCandidates([issue("z")]);
    h.setPr("z", "unknown");
    const second = await h.watcher.scan({
      skipIds: new Set(),
      preexistingFix: { conflicted: 2, ciFailed: 1 },
    });
    expect(second.counts.conflicted).toBe(2);
    expect(second.counts.ciFailed).toBe(1);
  });
});

describe("PrWatcher.scan — red PRs", () => {
  test("fresh conflict detection → enqueue-fix effect with notifyDetection", async () => {
    h.setCandidates([issue("a")]);
    h.setPr("a", "conflicted");
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([
      {
        kind: "enqueue-fix",
        issue: expect.objectContaining({ id: "a" }),
        trigger: "conflict-fix",
        prUrl: expect.stringContaining("/pull/"),
        fresh: true,
        notifyDetection: true,
      },
    ]);
    expect(result.counts.conflicted).toBe(1);
    expect(h.director.peek("a")?.value).toBe("conflict-fix");
  });

  test("a ticket already in a fix state → resumed enqueue-fix, no re-detection", async () => {
    h.setCandidates([issue("a")]);
    h.setPr("a", "conflicted");
    await h.director.dispatch(
      { key: "a" },
      { type: "RESUME_DETECTED" },
      { type: "CONFLICT_DETECTED" },
    );
    const attemptsBefore = h.director.peek("a")?.recovery?.attempts;
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([
      expect.objectContaining({ kind: "enqueue-fix", fresh: false, notifyDetection: false }),
    ]);
    expect(h.director.peek("a")?.recovery?.attempts).toBe(attemptsBefore);
  });

  test("detection tipping over the threshold → bail effect, counted as quarantined", async () => {
    h = makeHarness({ enabled: true, fixCi: true, fixConflicts: true }, 1);
    h.setCandidates([issue("a")]);
    h.setPr("a", "ci_failed");
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([
      expect.objectContaining({ kind: "bail", reason: "ci_failed", attempts: 1 }),
    ]);
    expect(result.counts.ciFailed).toBe(0);
    expect(result.counts.quarantined).toBe(1);
  });

  test("an already-quarantined ticket with the bail stamp emits nothing", async () => {
    h = makeHarness({ enabled: true, fixCi: true, fixConflicts: true }, 1);
    h.setCandidates([issue("a")]);
    h.setPr("a", "conflicted");
    await h.director.dispatch(
      { key: "a" },
      { type: "CONFLICT_DETECTED" },
      { type: "RECOVERY_NOTIFIED", kind: "bail", at: "2026-06-10T00:00:00.000Z" },
    );
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([]);
    expect(result.counts.quarantined).toBe(1);
  });

  test("quarantine retry: cleared error marker resets the machine and re-detects", async () => {
    h = makeHarness({ enabled: true, fixCi: true, fixConflicts: true }, 3);
    h.setCandidates([issue("a")]);
    h.setPr("a", "conflicted");
    // Drive straight to quarantined (threshold 3 → three detections).
    await h.director.dispatch(
      { key: "a" },
      { type: "CONFLICT_DETECTED" },
      { type: "WORKER_SUCCEEDED" },
      { type: "CONFLICT_DETECTED" },
      { type: "WORKER_SUCCEEDED" },
      { type: "CONFLICT_DETECTED" },
    );
    expect(h.director.peek("a")?.value).toBe("quarantined");
    h.errorClearedIds.add("a");
    const result = await h.watcher.scan(NO_SKIPS);
    // Reset to idle, then the still-red PR re-enters recovery as a fresh
    // detection (attempts restart at 1).
    expect(result.effects).toEqual([
      expect.objectContaining({ kind: "enqueue-fix", fresh: true, trigger: "conflict-fix" }),
    ]);
    expect(h.director.peek("a")?.recovery?.attempts).toBe(1);
  });
});

describe("PrWatcher.scan — mergeable PRs", () => {
  test("awaiting-ci + mergeable → advance-done effect", async () => {
    h.setCandidates([issue("a")]);
    h.setPr("a", "mergeable");
    await h.director.dispatch({ key: "a" }, { type: "RESUME_DETECTED" }, { type: "PR_OPENED" });
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([expect.objectContaining({ kind: "advance-done" })]);
    expect(result.counts.mergeable).toBe(1);
  });

  test("already in setDone state → silent settle to done, no effect", async () => {
    h.setCandidates([issue("a")]);
    h.setPr("a", "mergeable");
    h.setDoneIds.add("a");
    await h.director.dispatch({ key: "a" }, { type: "RESUME_DETECTED" }, { type: "PR_OPENED" });
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([]);
    // Actor reached done and was disposed.
    expect(h.director.peek("a")).toBeNull();
  });

  test("mergeable in a non-advanceable state only clears stale recovery", async () => {
    h.setCandidates([issue("a")]);
    h.setPr("a", "mergeable");
    await h.director.dispatch(
      { key: "a" },
      { type: "RESUME_DETECTED" },
      { type: "PR_OPENED" },
      { type: "CI_FAILED_DETECTED" }, // → ci-fix with a recovery record
      { type: "WORKER_SUCCEEDED" }, // → awaiting-ci, recovery kept
      { type: "REVIEW_TRIGGERED" }, // → review (non-advanceable)
    );
    const result = await h.watcher.scan(NO_SKIPS);
    expect(result.effects).toEqual([]);
    expect(h.director.peek("a")?.recovery).toBeUndefined();
  });
});
