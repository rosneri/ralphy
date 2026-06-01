import { describe, expect, test } from "bun:test";
import {
  defaultPriorityFor,
  orderQueueEntries,
  type QueueEntry,
  type QueueTrigger,
} from "../queue/queue-order";
import type { LinearIssue } from "../agent/linear";

interface IssueOverrides {
  labels?: string[];
  project?: LinearIssue["project"];
  milestone?: LinearIssue["milestone"];
  blockedByIds?: string[];
}

function issue(
  id: string,
  identifier: string,
  priority: number,
  createdAt: string,
  overrides: IssueOverrides = {},
): LinearIssue {
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
    labels: overrides.labels ?? [],
    priority,
    createdAt,
    blockedByIds: overrides.blockedByIds ?? [],
  };
}

function entry(
  id: string,
  identifier: string,
  trigger: QueueTrigger,
  priority = 3,
  createdAt = "2026-01-01T00:00:00Z",
  overrides: IssueOverrides = {},
): QueueEntry {
  return {
    issue: issue(id, identifier, priority, createdAt, overrides),
    trigger,
    priority: defaultPriorityFor(trigger),
  };
}

const autoMerge = { filter: [{ type: "label" as const, value: "ralph:auto-merge" }] };

describe("orderQueueEntries", () => {
  test("auto-merge boost beats higher Linear priority", () => {
    const boosted = entry("c1", "ENG-9", "conflict-fix", 0, "2026-01-01T00:00:00Z", {
      labels: ["ralph:auto-merge"],
    });
    const urgent = entry("t1", "ENG-1", "fresh", 1);
    const sorted = orderQueueEntries([urgent, boosted], autoMerge);
    expect(sorted[0]!.issue.identifier).toBe("ENG-9");
  });

  test("multiple auto-merge boosts stay first and compete by Linear priority", () => {
    const highPri = entry("c1", "ENG-9", "conflict-fix", 1, "2026-03-01T00:00:00Z", {
      labels: ["ralph:auto-merge"],
    });
    const lowPri = entry("c2", "ENG-8", "conflict-fix", 3, "2026-01-01T00:00:00Z", {
      labels: ["ralph:auto-merge"],
    });
    const urgent = entry("t1", "ENG-1", "fresh", 1);
    const sorted = orderQueueEntries([lowPri, urgent, highPri], autoMerge);
    expect(sorted.map((e) => e.issue.identifier)).toEqual(["ENG-9", "ENG-8", "ENG-1"]);
  });

  test("duplicate entries for one issue are all preserved, strongest trigger first", () => {
    const ciFix = entry("dup", "ENG-7", "ci-fix", 3);
    const review = entry("dup", "ENG-7", "review", 3);
    // Queue order [review, ci-fix]; ci-fix has the stronger trigger priority.
    const sorted = orderQueueEntries([review, ciFix]);
    expect(sorted.map((e) => e.trigger)).toEqual(["ci-fix", "review"]);
  });

  test("urgent beats medium", () => {
    const medium = entry("a", "ENG-1", "fresh", 3);
    const urgent = entry("b", "ENG-2", "fresh", 1);
    const sorted = orderQueueEntries([medium, urgent]);
    expect(sorted[0]!.issue.identifier).toBe("ENG-2");
  });

  test("trigger priority tiebreak among equal items: resume < conflict-fix < review < fresh", () => {
    const fresh = entry("a", "ENG-1", "fresh", 3);
    const review = entry("b", "ENG-2", "review", 3);
    const cf = entry("c", "ENG-3", "conflict-fix", 3);
    const resume = entry("d", "ENG-4", "resume", 3);
    const sorted = orderQueueEntries([fresh, review, cf, resume]);
    expect(sorted.map((e) => e.trigger)).toEqual(["resume", "conflict-fix", "review", "fresh"]);
  });

  test("FIFO tiebreaker within a bucket — older createdAt first", () => {
    const newer = entry("a", "ENG-1", "fresh", 3, "2026-02-01T00:00:00Z");
    const older = entry("b", "ENG-2", "fresh", 3, "2026-01-01T00:00:00Z");
    const sorted = orderQueueEntries([newer, older]);
    expect(sorted[0]!.issue.identifier).toBe("ENG-2");
  });

  test("no-priority (0) sorts after explicit priorities", () => {
    const none = entry("a", "ENG-1", "fresh", 0);
    const low = entry("b", "ENG-2", "fresh", 4);
    const sorted = orderQueueEntries([none, low]);
    expect(sorted[0]!.issue.identifier).toBe("ENG-2");
    expect(sorted[1]!.issue.identifier).toBe("ENG-1");
  });

  test("missing getAutoMerge: an auto-merge-labeled conflict-fix does not get promoted", () => {
    const boosted = entry("c1", "ENG-9", "conflict-fix", 0, "2026-01-01T00:00:00Z", {
      labels: ["ralph:auto-merge"],
    });
    const urgent = entry("t1", "ENG-1", "fresh", 1);
    const sorted = orderQueueEntries([boosted, urgent]);
    expect(sorted[0]!.issue.identifier).toBe("ENG-1");
  });

  test("explicit trigger priority overrides default trigger ordering", () => {
    const freshHigh: QueueEntry = {
      issue: issue("a", "ENG-1", 3, "2026-01-01T00:00:00Z"),
      trigger: "fresh",
      priority: -1,
    };
    const resumeDefault = entry("b", "ENG-2", "resume", 3);
    const sorted = orderQueueEntries([resumeDefault, freshHigh]);
    expect(sorted[0]!.issue.identifier).toBe("ENG-1");
  });

  test("remaining entries follow project → milestone → item order", () => {
    const highProject = { id: "p1", name: "High", priority: 1 };
    const lowProject = { id: "p2", name: "Low", priority: 4 };
    const m1 = { id: "m1", name: "M1", sortOrder: 1 };
    const m2 = { id: "m2", name: "M2", sortOrder: 2 };

    // Low project, even with an urgent item, must trail the high project.
    const lowUrgent = entry("x", "ENG-LOW", "fresh", 1, "2026-01-01T00:00:00Z", {
      project: lowProject,
      milestone: m1,
    });
    // High project: m1 before m2; within m1, higher item priority first.
    const hiM2 = entry("y", "ENG-M2", "fresh", 1, "2026-01-01T00:00:00Z", {
      project: highProject,
      milestone: m2,
    });
    const hiM1Med = entry("z", "ENG-M1-MED", "fresh", 3, "2026-01-01T00:00:00Z", {
      project: highProject,
      milestone: m1,
    });
    const hiM1Urgent = entry("w", "ENG-M1-URG", "fresh", 1, "2026-01-01T00:00:00Z", {
      project: highProject,
      milestone: m1,
    });

    const sorted = orderQueueEntries([lowUrgent, hiM2, hiM1Med, hiM1Urgent]);
    expect(sorted.map((e) => e.issue.identifier)).toEqual([
      "ENG-M1-URG",
      "ENG-M1-MED",
      "ENG-M2",
      "ENG-LOW",
    ]);
  });

  test("resume-before-fresh preserved among equal items, after auto-merge boost", () => {
    const project = { id: "p1", name: "P", priority: 2 };
    const boosted = entry("c1", "ENG-9", "conflict-fix", 0, "2026-01-01T00:00:00Z", {
      labels: ["ralph:auto-merge"],
    });
    const fresh = entry("a", "ENG-1", "fresh", 3, "2026-01-01T00:00:00Z", { project });
    const resume = entry("b", "ENG-2", "resume", 3, "2026-01-01T00:00:00Z", { project });
    const sorted = orderQueueEntries([fresh, boosted, resume], autoMerge);
    expect(sorted.map((e) => e.issue.identifier)).toEqual(["ENG-9", "ENG-2", "ENG-1"]);
  });
});

describe("defaultPriorityFor", () => {
  test("ranks resume below conflict-fix below review below fresh", () => {
    expect(defaultPriorityFor("resume")).toBeLessThan(defaultPriorityFor("conflict-fix"));
    expect(defaultPriorityFor("conflict-fix")).toBeLessThan(defaultPriorityFor("review"));
    expect(defaultPriorityFor("review")).toBeLessThan(defaultPriorityFor("fresh"));
  });
});

describe("SpawnMode is removed", () => {
  test("queue-order module exports no SpawnMode type", async () => {
    const mod = await import("../queue/queue-order");
    expect(Object.keys(mod)).not.toContain("SpawnMode");
  });
});
