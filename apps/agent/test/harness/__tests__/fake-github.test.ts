import { describe, expect, test } from "bun:test";
import { createFakeGithub, GITHUB_LABELS } from "../fake-github";
import type { SeedIssue } from "../types";

const seed = (over: Partial<SeedIssue> = {}): SeedIssue => ({
  id: over.id ?? "1",
  identifier: over.identifier ?? "#1",
  title: over.title ?? "x",
  labels: over.labels,
});

const ids = async (p: Promise<{ identifier: string }[]>) => (await p).map((i) => i.identifier);

describe("FakeGithub bucket filtering", () => {
  test("todo requires selection label AND excludes any lifecycle label", async () => {
    const fake = createFakeGithub();
    fake.seed(seed({ id: "1", identifier: "#1", labels: [GITHUB_LABELS.selection] }));
    fake.seed(
      seed({
        id: "2",
        identifier: "#2",
        labels: [GITHUB_LABELS.selection, GITHUB_LABELS.inProgress],
      }),
    );
    fake.seed(seed({ id: "3", identifier: "#3", labels: [] }));
    expect(await ids(fake.client.fetchTodo())).toEqual(["#1"]);
  });

  test("inProgress / review buckets are label-driven and open-only", async () => {
    const fake = createFakeGithub();
    fake.seed(seed({ id: "1", identifier: "#1", labels: [GITHUB_LABELS.inProgress] }));
    fake.seed(seed({ id: "2", identifier: "#2", labels: [GITHUB_LABELS.review] }));
    expect(await ids(fake.client.fetchInProgress())).toEqual(["#1"]);
    expect(await ids(fake.client.fetchReview())).toEqual(["#2"]);
    // Closing the in-progress issue drops it from the open-only bucket.
    fake.setOpen("1", false);
    expect(await ids(fake.client.fetchInProgress())).toEqual([]);
  });

  test("doneCandidates are the closed issues", async () => {
    const fake = createFakeGithub();
    fake.seed(seed({ id: "1", identifier: "#1", labels: [GITHUB_LABELS.selection] }));
    expect(await ids(fake.client.fetchDoneCandidates())).toEqual([]);
    fake.setOpen("1", false);
    expect(await ids(fake.client.fetchDoneCandidates())).toEqual(["#1"]);
  });
});

describe("FakeGithub applyIndicator", () => {
  test("done indicator closes the issue and logs setDone", async () => {
    const fake = createFakeGithub();
    const issue = fake.seed(
      seed({ id: "1", identifier: "#1", labels: [GITHUB_LABELS.inProgress] }),
    );
    await fake.client.applyIndicator(issue, { type: "label", value: GITHUB_LABELS.done });
    expect(fake.applied.setDone).toEqual(["#1"]);
    expect(await ids(fake.client.fetchDoneCandidates())).toEqual(["#1"]);
    // The done marker is never stored as a label.
    expect(fake.issues()[0]?.labels).not.toContain(GITHUB_LABELS.done);
  });

  test("pr-ready is classified before the in-progress fallback", async () => {
    const fake = createFakeGithub();
    const issue = fake.seed(seed({ id: "1", identifier: "#1", labels: [GITHUB_LABELS.selection] }));
    await fake.client.applyIndicator(issue, { type: "label", value: GITHUB_LABELS.prReady });
    expect(fake.applied.setPrReady).toEqual(["#1"]);
    expect(fake.applied.setInProgress).toEqual([]);
  });

  test("in-progress and error indicators add labels and log their slot", async () => {
    const fake = createFakeGithub();
    const issue = fake.seed(seed({ id: "1", identifier: "#1", labels: [GITHUB_LABELS.selection] }));
    await fake.client.applyIndicator(issue, { type: "label", value: GITHUB_LABELS.inProgress });
    await fake.client.applyIndicator(issue, { type: "label", value: GITHUB_LABELS.error });
    expect(fake.applied.setInProgress).toEqual(["#1"]);
    expect(fake.applied.setError).toEqual(["#1"]);
    expect(fake.issues()[0]?.labels).toContain(GITHUB_LABELS.inProgress);
    expect(fake.issues()[0]?.labels).toContain(GITHUB_LABELS.error);
  });
});

describe("FakeGithub removeIndicator and helpers", () => {
  test("removing the review label logs clearReview and drops from review", async () => {
    const fake = createFakeGithub();
    const issue = fake.seed(seed({ id: "1", identifier: "#1", labels: [GITHUB_LABELS.review] }));
    await fake.client.removeIndicator(issue, { type: "label", value: GITHUB_LABELS.review });
    expect(fake.applied.clearReview).toEqual(["#1"]);
    expect(await ids(fake.client.fetchReview())).toEqual([]);
  });

  test("setLabels replaces labels; comments round-trip via fetchComments", async () => {
    const fake = createFakeGithub();
    fake.seed(seed({ id: "1", identifier: "#1", labels: ["a"] }));
    fake.setLabels("1", ["b", "c"]);
    expect(fake.issues()[0]?.labels).toEqual(["b", "c"]);
    fake.pushComment("1", "note", "Alice");
    expect((await fake.client.fetchComments("1")).map((c) => c.body)).toEqual(["note"]);
  });

  test("pushMention surfaces via fetchMentions with source", async () => {
    const fake = createFakeGithub();
    fake.seed(seed({ id: "1", identifier: "#1" }));
    fake.pushMention("1", "github", "@ralphy ping", new Date("2025-01-02T00:00:00Z"));
    const mentions = await fake.client.fetchMentions();
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.trigger.source).toBe("github");
    expect(mentions[0]?.trigger.body).toBe("@ralphy ping");
  });

  test("setLabels / setOpen on an unknown issue throw", () => {
    const fake = createFakeGithub();
    expect(() => fake.setLabels("nope", [])).toThrow();
    expect(() => fake.setOpen("nope", false)).toThrow();
  });
});
