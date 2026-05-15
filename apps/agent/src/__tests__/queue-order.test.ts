import { describe, expect, test } from "bun:test";
import { compareQueueEntries, type QueueEntry } from "../queue/queue-order";
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
    labels,
    priority,
    createdAt,
    blockedByIds: [],
  };
}

function entry(
  id: string,
  identifier: string,
  mode: QueueEntry["mode"],
  priority = 3,
  createdAt = "2026-01-01T00:00:00Z",
  labels: string[] = [],
): QueueEntry {
  return { issue: issue(id, identifier, priority, createdAt, labels), mode };
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

  test("mode rank tiebreaker: resume < conflict-fix < review < fresh", () => {
    const fresh = entry("a", "ENG-1", "fresh", 3);
    const review = entry("b", "ENG-2", "review", 3);
    const cf = entry("c", "ENG-3", "conflict-fix", 3);
    const resume = entry("d", "ENG-4", "resume", 3);
    const sorted = [fresh, review, cf, resume].sort(compareQueueEntries());
    expect(sorted.map((e) => e.mode)).toEqual(["resume", "conflict-fix", "review", "fresh"]);
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
});
