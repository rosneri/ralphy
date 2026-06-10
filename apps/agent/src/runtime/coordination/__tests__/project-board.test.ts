/**
 * RFC #402 — projectBoard boundary tests: snapshot fixtures in, rows out.
 * Pure function, zero mocks.
 */
import { describe, expect, test } from "bun:test";
import type { FlowSnapshotView } from "@ralphy/core/machines";
import type { TrackedIssue } from "@ralphy/tracker";
import { projectBoard, type BoardSource } from "../project-board";

function issue(id: string, overrides: Partial<TrackedIssue> = {}): TrackedIssue {
  return {
    id,
    identifier: id.toUpperCase(),
    title: `Issue ${id}`,
    description: null,
    url: `https://example/${id}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
    ...overrides,
  };
}

function source(
  id: string,
  kind: BoardSource["kind"],
  overrides: Partial<TrackedIssue> = {},
): BoardSource {
  return { issue: issue(id, overrides), kind, changeName: `change-${id}` };
}

function view(
  id: string,
  value: string,
  recovery?: FlowSnapshotView["recovery"],
): [string, FlowSnapshotView] {
  return [id, { issueId: id, value, recovery }];
}

const NO_PRS: ReadonlyMap<string, string> = new Map();

describe("projectBoard — source precedence and dedup", () => {
  test("first occurrence wins and fixes the render order", () => {
    const rows = projectBoard({
      sources: [
        source("a", "worker"),
        source("b", "queued"),
        source("a", "in-progress"), // dup — dropped
        source("c", "todo"),
      ],
      snapshots: new Map([view("a", "working"), view("b", "working")]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ["a", "working"],
      ["b", "queued"],
      ["c", "todo"],
    ]);
  });

  test("todo / mention / awaiting rows are direct-assigned (no snapshot needed)", () => {
    const rows = projectBoard({
      sources: [source("t", "todo"), source("m", "mention"), source("g", "awaiting")],
      snapshots: new Map(),
      prUrlByIssue: NO_PRS,
    });
    expect(rows.map((r) => r.state)).toEqual(["todo", "review", "awaiting"]);
  });

  test("done tickets are excluded — done is a transient glyph, not a resting row", () => {
    const rows = projectBoard({
      sources: [source("d", "in-progress"), source("w", "worker")],
      snapshots: new Map([view("d", "done"), view("w", "working")]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows.map((r) => r.id)).toEqual(["w"]);
  });

  test("a missing snapshot falls back to a fresh idle actor (in-progress)", () => {
    const rows = projectBoard({
      sources: [source("x", "in-progress")],
      snapshots: new Map(),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("in-progress");
  });
});

describe("projectBoard — blocked demotion", () => {
  test("a blocked non-worker row is parked as todo even when its actor says working", () => {
    const rows = projectBoard({
      sources: [source("b", "in-progress", { blockedByIds: ["other"] })],
      snapshots: new Map([view("b", "working")]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("todo");
    expect(rows[0]?.blockedByIds).toEqual(["other"]);
  });

  test("a blocked ticket with a LIVE worker keeps its real state", () => {
    const rows = projectBoard({
      sources: [source("b", "worker", { blockedByIds: ["other"] })],
      snapshots: new Map([view("b", "working")]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("working");
  });
});

describe("projectBoard — queued-vs-working contradiction", () => {
  test("a queued row whose actor already reads working is shown as queued", () => {
    const rows = projectBoard({
      sources: [source("q", "queued")],
      snapshots: new Map([view("q", "working")]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("queued");
  });

  test("a queued row in a fix state keeps the fix state (not demoted to queued)", () => {
    const rows = projectBoard({
      sources: [source("q", "queued")],
      snapshots: new Map([
        view("q", "conflict-fix", {
          attempts: 1,
          lastReason: "conflicting",
          firstFailedAt: "",
          prUrl: "",
        }),
      ]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("conflict-fix");
  });
});

describe("projectBoard — recovery overlay", () => {
  const failing = (reason: "conflicting" | "ci_failed") => ({
    attempts: 2,
    lastReason: reason,
    firstFailedAt: "2026-06-01T00:00:00.000Z",
    prUrl: "https://github.com/o/r/pull/7",
  });

  test("an unresolved failure folds onto a cleanly-waiting awaiting-ci row", () => {
    const rows = projectBoard({
      sources: [source("f", "in-progress")],
      snapshots: new Map([view("f", "awaiting-ci", failing("ci_failed"))]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("ci-fix");
    expect(rows[0]?.recovery).toEqual({
      attempts: 2,
      bailed: false,
      firstFailedAt: "2026-06-01T00:00:00.000Z",
      lastReason: "ci_failed",
    });
  });

  test("conflicting recovery folds to conflict-fix", () => {
    const rows = projectBoard({
      sources: [source("f", "in-progress")],
      snapshots: new Map([view("f", "working", failing("conflicting"))]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("conflict-fix");
  });

  test("quarantined rows surface bailed recovery", () => {
    const rows = projectBoard({
      sources: [source("f", "in-progress")],
      snapshots: new Map([view("f", "quarantined", failing("conflicting"))]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.state).toBe("quarantined");
    expect(rows[0]?.recovery?.bailed).toBe(true);
  });

  test("the snapshot's recovery.prUrl backfills rows the scan skipped this poll", () => {
    const rows = projectBoard({
      sources: [source("f", "in-progress")],
      snapshots: new Map([view("f", "awaiting-ci", failing("conflicting"))]),
      prUrlByIssue: NO_PRS,
    });
    expect(rows[0]?.prUrl).toBe("https://github.com/o/r/pull/7");
  });

  test("a scan-resolved PR URL wins over the snapshot's recorded one", () => {
    const rows = projectBoard({
      sources: [source("f", "in-progress")],
      snapshots: new Map([view("f", "awaiting-ci", failing("conflicting"))]),
      prUrlByIssue: new Map([["f", "https://github.com/o/r/pull/8"]]),
    });
    expect(rows[0]?.prUrl).toBe("https://github.com/o/r/pull/8");
  });
});
