import { describe, expect, test } from "bun:test";
import { backlogRankByIssueId } from "../list";
import { sortRows, type SortableRow } from "../list-sort";
import { defaultPriorityFor, orderQueueEntries, type QueueEntry } from "../queue/queue-order";
import type { TrackedIssue } from "@ralphy/tracker";

interface IssueOverrides {
  project?: TrackedIssue["project"];
  milestone?: TrackedIssue["milestone"];
  cycle?: TrackedIssue["cycle"];
  blockedByIds?: string[];
}

function issue(
  id: string,
  identifier: string,
  priority: number,
  createdAt: string,
  overrides: IssueOverrides = {},
): TrackedIssue {
  return {
    id,
    identifier,
    title: identifier,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: overrides.project ?? null,
    ...(overrides.milestone ? { milestone: overrides.milestone } : {}),
    ...(overrides.cycle ? { cycle: overrides.cycle } : {}),
    labels: [],
    priority,
    createdAt,
    blockedByIds: overrides.blockedByIds ?? [],
  };
}

/** Render order of `agent list` for issues with no PR status — i.e. the pure
 *  hierarchical backlog order, exactly as `fetchAndPrintLinear` derives it. */
function listOrder(issues: TrackedIssue[]): string[] {
  const rankById = backlogRankByIssueId(issues);
  const rows: (SortableRow & { identifier: string })[] = issues.map((i) => ({
    identifier: i.identifier,
    status: null,
    bucketOrder: rankById.get(i.id) ?? 0,
    issueCreatedAt: i.createdAt,
  }));
  return sortRows(rows).map((r) => r.identifier);
}

/** Queue order for the same issues, all as plain `fresh` entries (so no
 *  trigger or auto-merge override differentiates them). */
function queueOrder(issues: TrackedIssue[]): string[] {
  const entries: QueueEntry[] = issues.map((i) => ({
    issue: i,
    trigger: "fresh",
    priority: defaultPriorityFor("fresh"),
  }));
  return orderQueueEntries(entries).map((e) => e.issue.identifier);
}

describe("agent list / queue order consistency", () => {
  test("list order matches queue order across project → milestone → item levels", () => {
    const highProject = { id: "p1", name: "High", priority: 1 };
    const lowProject = { id: "p2", name: "Low", priority: 4 };
    const m1 = { id: "m1", name: "M1", sortOrder: 1 };
    const m2 = { id: "m2", name: "M2", sortOrder: 2 };

    const issues = [
      issue("x", "ENG-LOW", 1, "2026-01-01T00:00:00Z", { project: lowProject, milestone: m1 }),
      issue("y", "ENG-M2", 1, "2026-01-01T00:00:00Z", { project: highProject, milestone: m2 }),
      issue("z", "ENG-M1-MED", 3, "2026-01-01T00:00:00Z", { project: highProject, milestone: m1 }),
      issue("w", "ENG-M1-URG", 1, "2026-01-01T00:00:00Z", { project: highProject, milestone: m1 }),
    ];

    const expected = ["ENG-M1-URG", "ENG-M1-MED", "ENG-M2", "ENG-LOW"];
    expect(queueOrder(issues)).toEqual(expected);
    expect(listOrder(issues)).toEqual(expected);
  });

  test("list order matches queue order with item dependencies and no project", () => {
    // B depends on A (same milestone) ⇒ A before B even though B is higher
    // priority; independent higher-priority C still leads.
    const m = { id: "m1", name: "M", sortOrder: 1 };
    const issues = [
      issue("a", "ENG-A", 3, "2026-01-02T00:00:00Z", { milestone: m }),
      issue("b", "ENG-B", 1, "2026-01-03T00:00:00Z", { milestone: m, blockedByIds: ["a"] }),
      issue("c", "ENG-C", 1, "2026-01-01T00:00:00Z", { milestone: m }),
    ];

    expect(listOrder(issues)).toEqual(queueOrder(issues));
    expect(listOrder(issues)).toEqual(["ENG-C", "ENG-A", "ENG-B"]);
  });
});

describe("agent list / queue order consistency — cycles", () => {
  test("cycle ordering is identical in the queue and the list", () => {
    const project = { id: "p1", name: "P", priority: 1 };
    const m = { id: "m1", name: "M", sortOrder: 1 };
    const current = {
      id: "c1",
      number: 7,
      name: "Cycle 7",
      startsAt: "2026-03-01T00:00:00Z",
      endsAt: "2026-03-15T00:00:00Z",
    };
    const upcoming = { id: "c2", number: 8, startsAt: "2026-03-15T00:00:00Z" };

    const issues = [
      // Un-cycled and urgent — still last, cycle outranks item priority.
      issue("n", "ENG-NONE", 1, "2026-01-01T00:00:00Z", { project, milestone: m }),
      issue("u", "ENG-UPCOMING", 3, "2026-01-01T00:00:00Z", {
        project,
        milestone: m,
        cycle: upcoming,
      }),
      issue("c", "ENG-CURRENT", 3, "2026-01-01T00:00:00Z", {
        project,
        milestone: m,
        cycle: current,
      }),
    ];

    const expected = ["ENG-CURRENT", "ENG-UPCOMING", "ENG-NONE"];
    expect(queueOrder(issues)).toEqual(expected);
    expect(listOrder(issues)).toEqual(expected);
  });

  test("a cycled dependent never precedes its un-cycled same-milestone blocker", () => {
    const m = { id: "m1", name: "M", sortOrder: 1 };
    const cycle = { id: "c1", number: 7, startsAt: "2026-03-01T00:00:00Z" };
    const issues = [
      issue("dep", "ENG-DEP", 1, "2026-01-02T00:00:00Z", {
        milestone: m,
        cycle,
        blockedByIds: ["blk"],
      }),
      issue("blk", "ENG-BLK", 4, "2026-01-01T00:00:00Z", { milestone: m }),
    ];

    const expected = ["ENG-BLK", "ENG-DEP"];
    expect(queueOrder(issues)).toEqual(expected);
    expect(listOrder(issues)).toEqual(expected);
  });
});
