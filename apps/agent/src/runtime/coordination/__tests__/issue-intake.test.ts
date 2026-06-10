/**
 * RFC #402 — planIntake boundary tests: eligibility / dependency gate /
 * ticket budget / bucket precedence as pure table cases.
 */
import { describe, expect, test } from "bun:test";
import type { TrackedIssue } from "@ralphy/tracker";
import type { MentionTrigger } from "../../../queue/queue-order";
import { planIntake } from "../issue-intake";

function issue(id: string, blockedByIds: string[] = []): TrackedIssue {
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
    blockedByIds,
  };
}

const mention: MentionTrigger = {
  source: "linear",
  body: "@ralphy please revisit",
  createdAt: "2026-06-01T00:00:00.000Z",
};

const NONE = new Set<string>();

describe("planIntake", () => {
  test("buckets keep precedence: resume → mention → todo", () => {
    const plan = planIntake(
      {
        resumable: [issue("r")],
        mentions: [{ issue: issue("m"), trigger: mention }],
        todo: [issue("t")],
      },
      { busyIds: NONE, budget: Infinity },
    );
    expect(plan.entries.map((e) => [e.issue.id, e.trigger])).toEqual([
      ["r", "resume"],
      ["m", "review"],
      ["t", "fresh"],
    ]);
  });

  test("busy issues are never planned; first plan of an id wins", () => {
    const plan = planIntake(
      {
        resumable: [issue("busy"), issue("dup")],
        mentions: [{ issue: issue("dup"), trigger: mention }],
        todo: [issue("dup")],
      },
      { busyIds: new Set(["busy"]), budget: Infinity },
    );
    expect(plan.entries.map((e) => [e.issue.id, e.trigger])).toEqual([["dup", "resume"]]);
  });

  test("a non-empty blockedBy list parks resume and todo entries", () => {
    const plan = planIntake(
      {
        resumable: [issue("r", ["x"])],
        mentions: [],
        todo: [issue("t", ["y"]), issue("ok")],
      },
      { busyIds: NONE, budget: Infinity },
    );
    expect(plan.entries.map((e) => e.issue.id)).toEqual(["ok"]);
    expect(plan.blocked.map((b) => b.id)).toEqual(["r", "t"]);
  });

  test("mentions bypass the dependency gate — a human asked for this pass", () => {
    const plan = planIntake(
      { resumable: [], mentions: [{ issue: issue("m", ["x"]), trigger: mention }], todo: [] },
      { busyIds: NONE, budget: Infinity },
    );
    expect(plan.entries.map((e) => e.trigger)).toEqual(["review"]);
    expect(plan.blocked).toEqual([]);
  });

  test("the budget is consumed across buckets in precedence order", () => {
    const plan = planIntake(
      {
        resumable: [issue("r1"), issue("r2")],
        mentions: [{ issue: issue("m"), trigger: mention }],
        todo: [issue("t")],
      },
      { busyIds: NONE, budget: 3 },
    );
    expect(plan.entries.map((e) => e.issue.id)).toEqual(["r1", "r2", "m"]);
  });

  test("budget 0 plans nothing; blocked issues are not even reported", () => {
    const plan = planIntake(
      { resumable: [issue("r", ["x"])], mentions: [], todo: [issue("t")] },
      { busyIds: NONE, budget: 0 },
    );
    expect(plan.entries).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  test("blocked issues do not consume budget", () => {
    const plan = planIntake(
      { resumable: [], mentions: [], todo: [issue("b", ["x"]), issue("t")] },
      { busyIds: NONE, budget: 1 },
    );
    expect(plan.entries.map((e) => e.issue.id)).toEqual(["t"]);
  });
});
