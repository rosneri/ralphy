import { describe, expect, test } from "bun:test";
import {
  inspectAwaitingTicket,
  defaultConfirmation,
  type ConfirmationState,
  type AwaitingInspectionConfig,
  type AwaitingInspectionDeps,
} from "../agent/awaiting-confirmation";
import type { SetIndicator } from "@ralphy/types";

function baseConfig(overrides: Partial<AwaitingInspectionConfig> = {}): AwaitingInspectionConfig {
  return {
    mentionHandle: "@ralphy",
    timeoutHours: 4,
    maxConfirmationRounds: 3,
    postComments: true,
    ...overrides,
  };
}

interface Recorder {
  applied: SetIndicator[];
  postedComments: string[];
  reactedComments: { id: string; emoji: string }[];
  steering: string[];
  restarts: number;
  stuckLabels: number;
}

function makeDeps(
  overrides: Partial<AwaitingInspectionDeps> & {
    approvalMatches?: boolean;
    comments?: { id: string; body: string; createdAt: string }[];
    clearApproved?: SetIndicator;
  } = {},
): { deps: AwaitingInspectionDeps; rec: Recorder } {
  const rec: Recorder = {
    applied: [],
    postedComments: [],
    reactedComments: [],
    steering: [],
    restarts: 0,
    stuckLabels: 0,
  };
  const comments = overrides.comments ?? [];
  const deps: AwaitingInspectionDeps = {
    approvalMatches: overrides.approvalMatches ?? false,
    fetchComments: async () => comments,
    applyIndicator: async (ind) => {
      rec.applied.push(ind);
    },
    postComment: async (b) => {
      rec.postedComments.push(b);
    },
    reactToComment: async (id, emoji) => {
      rec.reactedComments.push({ id, emoji });
    },
    applyStuckLabel: async () => {
      rec.stuckLabels += 1;
    },
    appendSteering: async (m) => {
      rec.steering.push(m);
    },
    restartFromDesign: async () => {
      rec.restarts += 1;
    },
    log: () => {},
    ...(overrides.clearApproved ? { clearApproved: overrides.clearApproved } : {}),
  };
  return { deps, rec };
}

describe("inspectAwaitingTicket — approval path", () => {
  test("fires clearApproved + persists confirmedAt", async () => {
    const clearApproved: SetIndicator = { type: "label", value: "approve" };
    const { deps, rec } = makeDeps({ approvalMatches: true, clearApproved });
    const { outcome, next } = await inspectAwaitingTicket(
      defaultConfirmation(),
      baseConfig(),
      deps,
    );
    expect(outcome).toBe("approved");
    expect(next.confirmedAt).not.toBeNull();
    expect(rec.applied).toEqual([clearApproved]);
  });
});

describe("inspectAwaitingTicket — revise path", () => {
  test("appends steering, restarts design, bumps rounds, resets confirmedAt", async () => {
    const { deps, rec } = makeDeps({
      comments: [
        {
          id: "c1",
          body: "@ralphy revise: please rethink the schema",
          createdAt: "2026-05-20T10:00:00.000Z",
        },
      ],
    });
    const start: ConfirmationState = {
      ...defaultConfirmation(),
      askedAt: "2026-05-20T09:00:00.000Z",
      confirmedAt: "2026-05-20T09:30:00.000Z",
    };
    const { outcome, next } = await inspectAwaitingTicket(start, baseConfig(), deps);
    expect(outcome).toBe("revised");
    expect(next.rounds).toBe(1);
    expect(next.confirmedAt).toBeNull();
    expect(next.askedAt).toBeNull();
    expect(next.lastReviseConsumedAt).toBe("2026-05-20T10:00:00.000Z");
    expect(rec.steering[0]).toContain("please rethink the schema");
    expect(rec.restarts).toBe(1);
    expect(rec.reactedComments).toEqual([{ id: "c1", emoji: "👀" }]);
  });

  test("ignores revise comments at or before lastReviseConsumedAt watermark", async () => {
    const { deps } = makeDeps({
      comments: [
        {
          id: "c1",
          body: "@ralphy revise: old request",
          createdAt: "2026-05-20T09:00:00.000Z",
        },
      ],
    });
    const start: ConfirmationState = {
      ...defaultConfirmation(),
      askedAt: "2026-05-20T08:00:00.000Z",
      lastReviseConsumedAt: "2026-05-20T09:00:00.000Z",
    };
    const { outcome } = await inspectAwaitingTicket(start, baseConfig(), deps);
    expect(outcome).toBe("stay-awaiting");
  });
});

describe("inspectAwaitingTicket — reminder cadence", () => {
  test("posts reminder once timeoutHours elapsed, persists lastReminderAt", async () => {
    const { deps, rec } = makeDeps();
    const askedAt = "2026-05-20T00:00:00.000Z";
    const now = new Date("2026-05-20T05:00:00.000Z"); // 5h elapsed > 4h limit
    const { outcome, next } = await inspectAwaitingTicket(
      { ...defaultConfirmation(), askedAt },
      baseConfig({ now: () => now }),
      deps,
    );
    expect(outcome).toBe("stay-awaiting");
    expect(next.lastReminderAt).toBe(now.toISOString());
    expect(rec.postedComments.some((b) => /still awaiting confirmation/.test(b))).toBe(true);
  });

  test("does not re-post reminder before timeoutHours have elapsed since lastReminderAt", async () => {
    const { deps, rec } = makeDeps();
    const askedAt = "2026-05-20T00:00:00.000Z";
    const lastReminderAt = "2026-05-20T05:00:00.000Z";
    const now = new Date("2026-05-20T06:00:00.000Z"); // only 1h since reminder
    const { outcome } = await inspectAwaitingTicket(
      { ...defaultConfirmation(), askedAt, lastReminderAt },
      baseConfig({ now: () => now }),
      deps,
    );
    expect(outcome).toBe("stay-awaiting");
    expect(rec.postedComments).toEqual([]);
  });
});

describe("inspectAwaitingTicket — round cap", () => {
  test("once rounds >= maxConfirmationRounds, posts stuck comment and applies stuck label exactly once", async () => {
    const { deps, rec } = makeDeps();
    const start: ConfirmationState = { ...defaultConfirmation(), rounds: 3 };
    const cfg = baseConfig({ maxConfirmationRounds: 3 });
    const first = await inspectAwaitingTicket(start, cfg, deps);
    expect(first.outcome).toBe("stuck");
    expect(first.next.stuckPostedAt).not.toBeNull();
    expect(rec.stuckLabels).toBe(1);
    expect(rec.postedComments.some((b) => /stuck/.test(b))).toBe(true);

    // Second invocation should be a no-op (idempotent).
    const second = await inspectAwaitingTicket(first.next, cfg, deps);
    expect(second.outcome).toBe("stuck");
    expect(rec.stuckLabels).toBe(1);
    expect(rec.postedComments.filter((b) => /stuck/.test(b)).length).toBe(1);
  });
});
