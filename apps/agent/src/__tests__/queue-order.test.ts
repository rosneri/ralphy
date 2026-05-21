import { describe, expect, test } from "bun:test";
import {
  compareQueueEntries,
  defaultPriorityFor,
  type QueueEntry,
  type QueueTrigger,
} from "../queue/queue-order";
import type { LinearIssue } from "../agent/linear";

function issue(
  id: string,
  identifier: string,
  priority: number,
  createdAt: string,
  labels: string[] = [],
): LinearIssue {
  return {
    id,
    identifier,
    title: identifier,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels,
    priority,
    createdAt,
    blockedByIds: [],
  };
}

function entry(
  id: string,
  identifier: string,
  trigger: QueueTrigger,
  priority = 3,
  createdAt = "2026-01-01T00:00:00Z",
  labels: string[] = [],
): QueueEntry {
  return {
    issue: issue(id, identifier, priority, createdAt, labels),
    trigger,
    priority: defaultPriorityFor(trigger),
  };
}

const autoMerge = { filter: [{ type: "label" as const, value: "ralph:auto-merge" }] };

describe("compareQueueEntries", () => {
  test("auto-merge boost beats higher Linear priority", () => {
    const boosted = entry("c1", "ENG-9", "conflict-fix", 0, "2026-01-01T00:00:00Z", [
      "ralph:auto-merge",
    ]);
    const urgent = entry("t1", "ENG-1", "fresh", 1);
    const sorted = [urgent, boosted].sort(compareQueueEntries(autoMerge));
    expect(sorted[0]!.issue.identifier).toBe("ENG-9");
  });

  test("urgent beats medium", () => {
    const medium = entry("a", "ENG-1", "fresh", 3);
    const urgent = entry("b", "ENG-2", "fresh", 1);
    const sorted = [medium, urgent].sort(compareQueueEntries());
    expect(sorted[0]!.issue.identifier).toBe("ENG-2");
  });

  test("priority tiebreaker: resume(0) < conflict-fix(1) < review(2) < fresh(3)", () => {
    const fresh = entry("a", "ENG-1", "fresh", 3);
    const review = entry("b", "ENG-2", "review", 3);
    const cf = entry("c", "ENG-3", "conflict-fix", 3);
    const resume = entry("d", "ENG-4", "resume", 3);
    const sorted = [fresh, review, cf, resume].sort(compareQueueEntries());
    expect(sorted.map((e) => e.trigger)).toEqual(["resume", "conflict-fix", "review", "fresh"]);
  });

  test("FIFO tiebreaker within a bucket — older createdAt first", () => {
    const newer = entry("a", "ENG-1", "fresh", 3, "2026-02-01T00:00:00Z");
    const older = entry("b", "ENG-2", "fresh", 3, "2026-01-01T00:00:00Z");
    const sorted = [newer, older].sort(compareQueueEntries());
    expect(sorted[0]!.issue.identifier).toBe("ENG-2");
  });

  test("no-priority (0) sorts after explicit priorities", () => {
    const none = entry("a", "ENG-1", "fresh", 0);
    const low = entry("b", "ENG-2", "fresh", 4);
    const sorted = [none, low].sort(compareQueueEntries());
    expect(sorted[0]!.issue.identifier).toBe("ENG-2");
    expect(sorted[1]!.issue.identifier).toBe("ENG-1");
  });

  test("missing getAutoMerge: an auto-merge-labeled conflict-fix does not get promoted", () => {
    const boosted = entry("c1", "ENG-9", "conflict-fix", 0, "2026-01-01T00:00:00Z", [
      "ralph:auto-merge",
    ]);
    const urgent = entry("t1", "ENG-1", "fresh", 1);
    const sorted = [boosted, urgent].sort(compareQueueEntries());
    expect(sorted[0]!.issue.identifier).toBe("ENG-1");
  });

  test("explicit priority overrides default trigger ordering", () => {
    const freshHigh: QueueEntry = {
      issue: issue("a", "ENG-1", 3, "2026-01-01T00:00:00Z"),
      trigger: "fresh",
      priority: -1,
    };
    const resumeDefault = entry("b", "ENG-2", "resume", 3);
    const sorted = [resumeDefault, freshHigh].sort(compareQueueEntries());
    expect(sorted[0]!.issue.identifier).toBe("ENG-1");
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
