import { describe, expect, test } from "bun:test";
import {
  pipelineStages,
  statusLabel,
  machineStateToTicketState,
  STATUS_GLYPH,
  PIPELINE_NODES,
  type TicketState,
  type TicketRow,
  type PipelineNodeStatus,
} from "../components/task-pipeline";

/** Every board-level state. Kept in sync by the exhaustiveness checks below —
 *  if a state is added to the union but not here, the `pipelineStages` /
 *  `statusLabel` switches' `never` arms make it a compile error first. */
const ALL_STATES: TicketState[] = [
  "todo",
  "queued",
  "working",
  "in-progress",
  "awaiting",
  "awaiting-ci",
  "conflict-fix",
  "ci-fix",
  "review",
  "quarantined",
  "done",
  "error",
];

function row(state: TicketState, recovery?: TicketRow["recovery"]): TicketRow {
  const base: TicketRow = {
    changeName: "change",
    id: "id",
    identifier: "RLF-1",
    title: "title",
    url: "https://example.test/pull/1",
    priority: 0,
    state,
  };
  return recovery ? { ...base, recovery } : base;
}

/** Compact the stages into a node→status record for readable assertions. */
function shape(
  state: TicketState,
  recovery?: TicketRow["recovery"],
): Record<string, PipelineNodeStatus> {
  const out: Record<string, PipelineNodeStatus> = {};
  for (const stage of pipelineStages(row(state, recovery))) out[stage.node] = stage.status;
  return out;
}

describe("task-pipeline · pipelineStages", () => {
  test("returns the five lifecycle nodes in order for every state", () => {
    for (const state of ALL_STATES) {
      const nodes = pipelineStages(row(state)).map((s) => s.node);
      expect(nodes).toEqual([...PIPELINE_NODES]);
    }
  });

  test("every node status is a known glyph key for every state", () => {
    for (const state of ALL_STATES) {
      for (const stage of pipelineStages(row(state))) {
        expect(STATUS_GLYPH[stage.status]).toBeDefined();
      }
    }
  });

  test("todo — only the todo node is current", () => {
    expect(shape("todo")).toEqual({
      todo: "current",
      work: "pending",
      PR: "pending",
      CI: "pending",
      done: "pending",
    });
  });

  test("queued / working / in-progress / awaiting — work is the current node", () => {
    for (const state of ["queued", "working", "in-progress", "awaiting"] as const) {
      expect(shape(state)).toEqual({
        todo: "done",
        work: "current",
        PR: "pending",
        CI: "pending",
        done: "pending",
      });
    }
  });

  test("awaiting-ci — PR opened, CI is the current node", () => {
    expect(shape("awaiting-ci")).toEqual({
      todo: "done",
      work: "done",
      PR: "done",
      CI: "current",
      done: "pending",
    });
  });

  test("conflict-fix — PR node failed (mergeability)", () => {
    expect(shape("conflict-fix")).toEqual({
      todo: "done",
      work: "done",
      PR: "failed",
      CI: "pending",
      done: "pending",
    });
  });

  test("ci-fix — CI node failed", () => {
    expect(shape("ci-fix")).toEqual({
      todo: "done",
      work: "done",
      PR: "done",
      CI: "failed",
      done: "pending",
    });
  });

  test("review — re-working a PR'd ticket; work current, PR/CI already passed", () => {
    expect(shape("review")).toEqual({
      todo: "done",
      work: "current",
      PR: "done",
      CI: "done",
      done: "pending",
    });
  });

  test("quarantined — bail glyph lands on the node implied by lastReason", () => {
    expect(
      shape("quarantined", {
        attempts: 3,
        lastReason: "ci_failed",
        bailed: true,
        firstFailedAt: "x",
      }),
    ).toEqual({
      todo: "done",
      work: "done",
      PR: "done",
      CI: "bailed",
      done: "pending",
    });
    expect(
      shape("quarantined", {
        attempts: 3,
        lastReason: "conflicting",
        bailed: true,
        firstFailedAt: "x",
      }),
    ).toEqual({
      todo: "done",
      work: "done",
      PR: "bailed",
      CI: "pending",
      done: "pending",
    });
  });

  test("quarantined — missing lastReason falls back to the CI node", () => {
    expect(shape("quarantined", { attempts: 3, bailed: true, firstFailedAt: "x" })).toMatchObject({
      CI: "bailed",
    });
  });

  test("done — all nodes passed", () => {
    expect(shape("done")).toEqual({
      todo: "done",
      work: "done",
      PR: "done",
      CI: "done",
      done: "done",
    });
  });

  test("error — work node failed", () => {
    expect(shape("error")).toMatchObject({ work: "failed" });
  });
});

describe("task-pipeline · statusLabel", () => {
  test("produces a non-empty label for every state", () => {
    for (const state of ALL_STATES) {
      expect(statusLabel(row(state)).length).toBeGreaterThan(0);
    }
  });

  test("recovery labels include attempt counts with correct pluralization", () => {
    expect(
      statusLabel(
        row("ci-fix", { attempts: 1, lastReason: "ci_failed", bailed: false, firstFailedAt: "x" }),
      ),
    ).toBe("CI red · 1 fix attempt");
    expect(
      statusLabel(
        row("conflict-fix", {
          attempts: 2,
          lastReason: "conflicting",
          bailed: false,
          firstFailedAt: "x",
        }),
      ),
    ).toBe("conflict · 2 fix attempts");
  });

  test("quarantined label reflects tries and last reason", () => {
    expect(
      statusLabel(
        row("quarantined", {
          attempts: 3,
          lastReason: "ci_failed",
          bailed: true,
          firstFailedAt: "x",
        }),
      ),
    ).toBe("quarantined · 3 tries (CI), bailed");
    expect(
      statusLabel(
        row("quarantined", {
          attempts: 4,
          lastReason: "conflicting",
          bailed: true,
          firstFailedAt: "x",
        }),
      ),
    ).toBe("quarantined · 4 tries (conflict), bailed");
  });
});

describe("task-pipeline · machineStateToTicketState", () => {
  test("maps every flow.machine resting + transient state", () => {
    const cases: Record<string, TicketState> = {
      idle: "in-progress",
      working: "working",
      "conflict-fix": "conflict-fix",
      "ci-fix": "ci-fix",
      awaiting: "awaiting",
      "awaiting-ci": "awaiting-ci",
      review: "review",
      preempting: "working",
      "routing-after-preempt": "working",
      done: "done",
      error: "error",
    };
    for (const [machine, expected] of Object.entries(cases)) {
      expect(machineStateToTicketState(machine)).toBe(expected);
    }
  });

  test("unknown machine states degrade to working rather than throwing", () => {
    expect(machineStateToTicketState("some-future-state")).toBe("working");
  });
});

describe("task-pipeline · STATUS_GLYPH", () => {
  test("covers all five statuses", () => {
    const statuses: PipelineNodeStatus[] = ["done", "current", "pending", "failed", "bailed"];
    for (const s of statuses) expect(typeof STATUS_GLYPH[s]).toBe("string");
  });
});
