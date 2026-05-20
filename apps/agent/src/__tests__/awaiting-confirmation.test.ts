import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSteeringNote,
  defaultConfirmation,
  inspectAwaitingTicket,
  readConfirmationState,
  restartFromDesign,
  writeConfirmationState,
  type AwaitingInspectionConfig,
  type AwaitingInspectionDeps,
  type ConfirmationState,
} from "../agent/confirmation";
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

describe("readConfirmationState / writeConfirmationState", () => {
  test("returns defaults when state file is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-"));
    try {
      const { stateObj, confirmation } = await readConfirmationState(join(dir, "missing.json"));
      expect(stateObj).toEqual({});
      expect(confirmation).toEqual(defaultConfirmation());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("round-trips confirmation through write + read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-"));
    try {
      const path = join(dir, "nested", "state.json");
      const next: ConfirmationState = {
        askedAt: "2026-05-20T01:00:00.000Z",
        lastReminderAt: null,
        confirmedAt: null,
        rounds: 2,
        stuckPostedAt: null,
        lastReviseConsumedAt: "2026-05-20T02:00:00.000Z",
      };
      await writeConfirmationState(path, { other: "field" }, next);
      const { stateObj, confirmation } = await readConfirmationState(path);
      expect(stateObj.other).toBe("field");
      expect(confirmation).toEqual(next);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recovers from malformed json by returning defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-"));
    try {
      const path = join(dir, "bad.json");
      await Bun.write(path, "not-json");
      const { stateObj, confirmation } = await readConfirmationState(path);
      expect(stateObj).toEqual({});
      expect(confirmation).toEqual(defaultConfirmation());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("restartFromDesign / appendSteeringNote", () => {
  test("restartFromDesign rewrites design.md and stubs tasks.md when present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-"));
    try {
      await Bun.write(join(dir, "tasks.md"), "# Tasks\n\n- [ ] keep me\n");
      await restartFromDesign(dir, "change-x");
      const design = await Bun.file(join(dir, "design.md")).text();
      expect(design).toContain("Design for change-x");
      const tasks = await Bun.file(join(dir, "tasks.md")).text();
      expect(tasks).toContain("Regenerating after revise request");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("restartFromDesign leaves tasks.md absent if it never existed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-"));
    try {
      await restartFromDesign(dir, "change-y");
      expect(await Bun.file(join(dir, "tasks.md")).exists()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("appendSteeringNote prepends to existing file and creates it otherwise", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-"));
    try {
      await appendSteeringNote(dir, "first");
      let body = await Bun.file(join(dir, "steering.md")).text();
      expect(body).toBe("first\n");
      await appendSteeringNote(dir, "second");
      body = await Bun.file(join(dir, "steering.md")).text();
      expect(body.startsWith("second\n\nfirst")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("inspectAwaitingTicket — error handlers are non-fatal", () => {
  test("clearApproved + appendSteering + restartFromDesign + reactToComment + postComment failures do not throw", async () => {
    const log: string[] = [];
    const clearApproved: SetIndicator = { type: "label", value: "approve" };
    const deps: AwaitingInspectionDeps = {
      approvalMatches: true,
      fetchComments: async () => [],
      clearApproved,
      applyIndicator: async () => {
        throw new Error("apply-fail");
      },
      postComment: async () => {
        throw new Error("post-fail");
      },
      reactToComment: async () => {
        throw new Error("react-fail");
      },
      applyStuckLabel: async () => {
        throw new Error("label-fail");
      },
      appendSteering: async () => {
        throw new Error("steer-fail");
      },
      restartFromDesign: async () => {
        throw new Error("restart-fail");
      },
      log: (line) => log.push(line),
    };
    const approved = await inspectAwaitingTicket(defaultConfirmation(), baseConfig(), deps);
    expect(approved.outcome).toBe("approved");
    expect(log.some((l) => /clearApproved failed/.test(l))).toBe(true);

    const reviseDeps: AwaitingInspectionDeps = {
      ...deps,
      approvalMatches: false,
      fetchComments: async () => [
        { id: "c1", body: "@ralphy revise: thing", createdAt: "2026-05-20T10:00:00.000Z" },
      ],
    };
    const revised = await inspectAwaitingTicket(
      { ...defaultConfirmation(), askedAt: "2026-05-20T09:00:00.000Z" },
      baseConfig(),
      reviseDeps,
    );
    expect(revised.outcome).toBe("revised");
    expect(log.some((l) => /appendSteering failed/.test(l))).toBe(true);
    expect(log.some((l) => /restartFromDesign failed/.test(l))).toBe(true);
    expect(log.some((l) => /revise ack comment failed/.test(l))).toBe(true);

    const stuck = await inspectAwaitingTicket(
      { ...defaultConfirmation(), rounds: 5 },
      baseConfig({ maxConfirmationRounds: 3 }),
      reviseDeps,
    );
    expect(stuck.outcome).toBe("stuck");
    expect(log.some((l) => /plan-stuck comment failed/.test(l))).toBe(true);
    expect(log.some((l) => /ralph:stuck label apply failed/.test(l))).toBe(true);

    // fetchComments failure leaves us in stay-awaiting without crashing.
    const fetchFail: AwaitingInspectionDeps = {
      ...reviseDeps,
      fetchComments: async () => {
        throw new Error("fetch-fail");
      },
    };
    const stay = await inspectAwaitingTicket(
      { ...defaultConfirmation(), askedAt: "2026-05-20T00:00:00.000Z" },
      baseConfig({ now: () => new Date("2026-05-20T00:30:00.000Z") }),
      fetchFail,
    );
    expect(stay.outcome).toBe("stay-awaiting");
    expect(log.some((l) => /fetchComments failed/.test(l))).toBe(true);

    // Reminder posting failure surfaces a log but stays awaiting.
    const reminderFail: AwaitingInspectionDeps = {
      ...deps,
      approvalMatches: false,
      fetchComments: async () => [],
    };
    const reminder = await inspectAwaitingTicket(
      { ...defaultConfirmation(), askedAt: "2026-05-20T00:00:00.000Z" },
      baseConfig({ now: () => new Date("2026-05-21T00:00:00.000Z") }),
      reminderFail,
    );
    expect(reminder.outcome).toBe("stay-awaiting");
    expect(log.some((l) => /reminder comment failed/.test(l))).toBe(true);
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
