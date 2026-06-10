import { describe, expect, test } from "bun:test";
import { parseRalphyMarker } from "@ralphy/comms";
import { createIssueTracker, ensureStickyMarker } from "../facade";
import type { IssueTrackerProvider } from "../provider";
import { InMemoryIssueTracker, makeTrackedIssue } from "../testing";

function stubProvider(overrides: Partial<IssueTrackerProvider> = {}): IssueTrackerProvider {
  return {
    fetchTodo: async () => [],
    fetchInProgress: async () => [],
    fetchReview: async () => [],
    fetchMentions: async () => [],
    fetchDoneCandidates: async () => [],
    fetchComments: async () => [],
    applyIndicator: async () => {},
    removeIndicator: async () => {},
    postComment: async () => {},
    ...overrides,
  };
}

describe("createIssueTracker", () => {
  test("poll() bundles the provider's four buckets into one snapshot", async () => {
    const todo = [makeTrackedIssue({ id: "t1" })];
    const inProgress = [makeTrackedIssue({ id: "p1" })];
    const done = [makeTrackedIssue({ id: "d1" })];
    const tracker = createIssueTracker(
      stubProvider({
        fetchTodo: async () => todo,
        fetchInProgress: async () => inProgress,
        fetchDoneCandidates: async () => done,
      }),
      {
        upsertStickyComment: async () => {},
        fetchPullRequestLinks: async () => [],
        fetchBlockers: async () => [],
      },
    );
    const snapshot = await tracker.poll();
    expect(snapshot.todo).toEqual(todo);
    expect(snapshot.inProgress).toEqual(inProgress);
    expect(snapshot.mentions).toEqual([]);
    expect(snapshot.doneCandidates).toEqual(done);
  });

  test("attachments default to null; sticky bodies get a marker stamped", async () => {
    const upserts: string[] = [];
    const tracker = createIssueTracker(stubProvider(), {
      upsertStickyComment: async (_issue, _type, body) => {
        upserts.push(body);
      },
      fetchPullRequestLinks: async () => [],
      fetchBlockers: async () => [],
    });
    expect(tracker.attachments).toBeNull();
    await tracker.upsertStickyComment(makeTrackedIssue(), "tasks", "plain body");
    expect(parseRalphyMarker(upserts[0]!)?.type).toBe("tasks");
  });
});

describe("ensureStickyMarker", () => {
  test("appends a marker only when the body has none", () => {
    const stamped = ensureStickyMarker("attachment", "hello");
    expect(parseRalphyMarker(stamped)?.type).toBe("attachment");
    // A body already carrying a typed marker is untouched.
    expect(ensureStickyMarker("attachment", stamped)).toBe(stamped);
  });
});

describe("InMemoryIssueTracker", () => {
  test("sticky upsert converges: N applies leave exactly one typed comment", async () => {
    const tracker = new InMemoryIssueTracker();
    const issue = makeTrackedIssue();
    await tracker.postComment(issue, "a human-ish comment");
    await tracker.upsertStickyComment(issue, "tasks", "v1");
    await tracker.upsertStickyComment(issue, "tasks", "v2");
    await tracker.upsertStickyComment(issue, "tasks", "v3");
    const comments = await tracker.fetchComments(issue.id);
    expect(comments).toHaveLength(2);
    expect(tracker.stickyComment(issue.id, "tasks")?.body).toContain("v3");
  });

  test("attachments capability is opt-in and round-trips", async () => {
    const bare = new InMemoryIssueTracker();
    expect(bare.attachments).toBeNull();

    const tracker = new InMemoryIssueTracker({ withAttachments: true });
    const attachments = tracker.attachments!;
    const assetUrl = await attachments.uploadFile({
      filename: "design.md",
      contentType: "text/markdown",
      bytes: new TextEncoder().encode("# design"),
    });
    const id = await attachments.attachUrl("issue-1", assetUrl, "Ralph design", "iteration 1");
    expect(await attachments.findByTitle("issue-1", "Ralph design")).toBe(id);
    await attachments.delete(id);
    expect(await attachments.findByTitle("issue-1", "Ralph design")).toBeNull();
  });

  test("poll snapshots the scripted buckets", async () => {
    const tracker = new InMemoryIssueTracker();
    tracker.todo = [makeTrackedIssue({ id: "t1" })];
    tracker.doneCandidates = [makeTrackedIssue({ id: "d1" })];
    const snapshot = await tracker.poll();
    expect(snapshot.todo.map((i) => i.id)).toEqual(["t1"]);
    expect(snapshot.doneCandidates.map((i) => i.id)).toEqual(["d1"]);
  });
});
