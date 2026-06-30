import { describe, expect, test } from "bun:test";
import { backlogRankByIssueId } from "../list/formatting";
import { sortRows, type SortableRow } from "../list-sort";
import { defaultPriorityFor, orderQueueEntries, type QueueEntry } from "../queue/queue-order";
import type { TrackedIssue } from "@ralphy/tracker";

interface IssueOverrides {
  project?: TrackedIssue["project"];
  milestone?: TrackedIssue["milestone"];
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
