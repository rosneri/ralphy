import { describe, expect, test } from "bun:test";
import {
  pipelineStages,
  statusLabel,
  buildBoardTree,
  orderActiveWorkersFirst,
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
  test("returns the six lifecycle nodes in order for every state", () => {
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
      confirmation: "pending",
      work: "pending",
      PR: "pending",
      CI: "pending",
      done: "pending",
    });
  });

  test("awaiting — parked at the confirmation gate before work", () => {
    expect(shape("awaiting")).toEqual({
      todo: "done",
      confirmation: "current",
      work: "pending",
      PR: "pending",
      CI: "pending",
      done: "pending",
    });
  });

  test("queued / working / in-progress — confirmation passed, work is current", () => {
    for (const state of ["queued", "working", "in-progress"] as const) {
      expect(shape(state)).toEqual({
        todo: "done",
        confirmation: "done",
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
      confirmation: "done",
      work: "done",
      PR: "done",
      CI: "current",
      done: "pending",
    });
  });

  test("conflict-fix — PR node failed (mergeability)", () => {
    expect(shape("conflict-fix")).toEqual({
      todo: "done",
      confirmation: "done",
      work: "done",
      PR: "failed",
      CI: "pending",
      done: "pending",
    });
  });

  test("ci-fix — CI node failed", () => {
    expect(shape("ci-fix")).toEqual({
      todo: "done",
      confirmation: "done",
      work: "done",
      PR: "done",
      CI: "failed",
      done: "pending",
    });
  });

  test("review — re-working a PR'd ticket; work current, PR/CI already passed", () => {
    expect(shape("review")).toEqual({
      todo: "done",
      confirmation: "done",
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
      confirmation: "done",
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
      confirmation: "done",
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
      confirmation: "done",
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

describe("task-pipeline · buildBoardTree", () => {
  function trow(id: string, blockedBy: { id: string; identifier: string }[] = []): TicketRow {
    return {
      changeName: `change-${id}`,
      id,
      identifier: id.toUpperCase(),
      title: `title ${id}`,
      url: `https://example.test/${id}`,
      priority: 0,
      state: "todo",
      blockedByIds: blockedBy.map((b) => b.id),
      blockedByIdentifiers: blockedBy.map((b) => b.identifier),
    };
  }

  test("unblocked rows keep their incoming order at depth 0", () => {
    const out = buildBoardTree([trow("a"), trow("b"), trow("c")]);
    expect(out.map((t) => t.row.id)).toEqual(["a", "b", "c"]);
    expect(out.every((t) => t.depth === 0)).toBe(true);
    expect(out.every((t) => t.blockerIdentifiers.length === 0)).toBe(true);
  });

  test("a blocked row nests under its in-board blocker", () => {
    // b is blocked by a; incoming order [b, a] — a must come first, b nests.
    const out = buildBoardTree([trow("b", [{ id: "a", identifier: "A" }]), trow("a")]);
    expect(out.map((t) => t.row.id)).toEqual(["a", "b"]);
    expect(out.map((t) => t.depth)).toEqual([0, 1]);
    expect(out[1]!.blockerIdentifiers).toEqual(["A"]);
  });

  test("a dependency chain indents one level per link", () => {
    const out = buildBoardTree([
      trow("c", [{ id: "b", identifier: "B" }]),
      trow("b", [{ id: "a", identifier: "A" }]),
      trow("a"),
    ]);
    expect(out.map((t) => t.row.id)).toEqual(["a", "b", "c"]);
    expect(out.map((t) => t.depth)).toEqual([0, 1, 2]);
  });

  test("siblings under one blocker keep incoming order", () => {
    const out = buildBoardTree([
      trow("a"),
      trow("c", [{ id: "a", identifier: "A" }]),
      trow("b", [{ id: "a", identifier: "A" }]),
    ]);
    expect(out.map((t) => t.row.id)).toEqual(["a", "c", "b"]);
    expect(out.map((t) => t.depth)).toEqual([0, 1, 1]);
  });

  test("a row blocked by two in-board rows sits below the deeper one", () => {
    // chain a(0) → b(1) → c(2); d depends on a(0) and c(2), deepest is c.
    const out = buildBoardTree([
      trow("a"),
      trow("b", [{ id: "a", identifier: "A" }]),
      trow("c", [{ id: "b", identifier: "B" }]),
      trow("d", [
        { id: "a", identifier: "A" },
        { id: "c", identifier: "C" },
      ]),
    ]);
    const byId = new Map(out.map((t) => [t.row.id, t]));
    expect(byId.get("d")!.depth).toBe(3); // max(0, 2) + 1
    // d appears after both blockers
    const ids = out.map((t) => t.row.id);
    expect(ids.indexOf("d")).toBeGreaterThan(ids.indexOf("a"));
    expect(ids.indexOf("d")).toBeGreaterThan(ids.indexOf("c"));
  });

  test("blockers not on the board do not nest but are still named", () => {
    const out = buildBoardTree([trow("a", [{ id: "ext", identifier: "EXT-9" }])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.depth).toBe(0); // ext is absent → roots at 0
    expect(out[0]!.blockerIdentifiers).toEqual([]); // in-board blockers only
    expect(out[0]!.row.blockedByIdentifiers).toEqual(["EXT-9"]); // still named for the suffix
  });

  test("a dependency cycle never deadlocks and preserves every row", () => {
    const out = buildBoardTree([
      trow("a", [{ id: "b", identifier: "B" }]),
      trow("b", [{ id: "a", identifier: "A" }]),
    ]);
    expect(out.map((t) => t.row.id).sort()).toEqual(["a", "b"]);
    expect(out).toHaveLength(2);
  });

  test("preserves row count and identity for a mixed board", () => {
    const rows = [
      trow("a"),
      trow("b", [{ id: "a", identifier: "A" }]),
      trow("c"),
      trow("d", [{ id: "z", identifier: "Z" }]), // dangling blocker
    ];
    const out = buildBoardTree(rows);
    expect(out).toHaveLength(rows.length);
    expect(new Set(out.map((t) => t.row.id))).toEqual(new Set(["a", "b", "c", "d"]));
  });

  test("ignores a self-referential blocker edge", () => {
    const out = buildBoardTree([trow("a", [{ id: "a", identifier: "A" }])]);
    expect(out[0]!.depth).toBe(0);
    expect(out[0]!.blockerIdentifiers).toEqual([]);
  });
});

describe("task-pipeline · orderActiveWorkersFirst", () => {
  function r(id: string, state: TicketState = "working"): TicketRow {
    return {
      changeName: id,
      id,
      identifier: id.toUpperCase(),
      title: id,
      url: `https://example.test/${id}`,
      priority: 0,
      state,
    };
  }

  test("returns a copy in original order when no workers are active", () => {
    const rows = [r("a"), r("b"), r("c")];
    const out = orderActiveWorkersFirst(rows, new Set());
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(rows); // copy, not the same array
  });

  test("pins active-worker rows to the front, preserving order within groups", () => {
    const rows = [r("a"), r("b"), r("c"), r("d")];
    const out = orderActiveWorkersFirst(rows, new Set(["c", "a"]));
    // active (a, c) keep their relative board order; rest (b, d) follow.
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b", "d"]);
  });

  test("preserves every row exactly", () => {
    const rows = [r("a"), r("b"), r("c")];
    const out = orderActiveWorkersFirst(rows, new Set(["b"]));
    expect(new Set(out.map((x) => x.id))).toEqual(new Set(["a", "b", "c"]));
    expect(out).toHaveLength(3);
  });

  test("a live worker leads even when it would otherwise sort lower", () => {
    const rows = [r("todo-1", "todo"), r("working-1", "working")];
    const out = orderActiveWorkersFirst(rows, new Set(["working-1"]));
    expect(out[0]!.id).toBe("working-1");
  });
});
