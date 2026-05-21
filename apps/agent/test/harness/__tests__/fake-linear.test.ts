import { describe, expect, test } from "bun:test";
import { createFakeLinear } from "../fake-linear";

describe("createFakeLinear", () => {
  test("filters fetchTodo/inProgress/conflicted/review by marker", async () => {
    const linear = createFakeLinear({
      getTodo: { filter: [{ type: "label", value: "ralphy:todo" }] },
      getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
      getConflicted: { filter: [{ type: "label", value: "ralphy:conflicted" }] },
      getReview: { filter: [{ type: "label", value: "ralphy:review" }] },
    });
    linear.seed({ id: "1", identifier: "RLF-1", title: "todo", labels: ["ralphy:todo"] });
    linear.seed({
      id: "2",
      identifier: "RLF-2",
      title: "in-progress",
      state: { name: "In Progress", type: "started" },
    });
    linear.seed({
      id: "3",
      identifier: "RLF-3",
      title: "conflicted",
      labels: ["ralphy:conflicted"],
    });
    linear.seed({ id: "4", identifier: "RLF-4", title: "review", labels: ["ralphy:review"] });

    expect((await linear.client.fetchTodo()).map((i) => i.identifier)).toEqual(["RLF-1"]);
    expect((await linear.client.fetchInProgress()).map((i) => i.identifier)).toEqual(["RLF-2"]);
    expect((await linear.client.fetchConflicted()).map((i) => i.identifier)).toEqual(["RLF-3"]);
    expect((await linear.client.fetchReview()).map((i) => i.identifier)).toEqual(["RLF-4"]);
  });

  test("postComment + fetchComments round-trip", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({ id: "1", identifier: "RLF-1", title: "x" });
    await linear.client.postComment(issue, "hello");
    expect((await linear.client.fetchComments("1"))[0]?.body).toBe("hello");
  });

  test("pushMention is surfaced via fetchMentions", async () => {
    const linear = createFakeLinear();
    linear.seed({ id: "1", identifier: "RLF-1", title: "x" });
    linear.pushMention("1", "linear", "@ralphy ping", new Date("2025-01-02T00:00:00Z"));
    const m = await linear.client.fetchMentions();
    expect(m).toHaveLength(1);
    expect(m[0]?.trigger.body).toBe("@ralphy ping");
    expect(m[0]?.trigger.source).toBe("linear");
  });

  test("applyIndicator / removeIndicator round-trips and logs to applied", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({ id: "1", identifier: "RLF-1", title: "x" });
    await linear.client.applyIndicator(issue, { type: "label", value: "ralphy:in-progress" });
    await linear.client.applyIndicator(issue, { type: "status", value: "Done" });
    await linear.client.removeIndicator(issue, { type: "label", value: "ralphy:conflicted" });
    expect(linear.applied.setInProgress).toContain("RLF-1");
    expect(linear.applied.setDone).toContain("RLF-1");
    expect(linear.applied.clearConflicted).toContain("RLF-1");
  });

  test("applyIndicator classifies setError, setConflicted (status), and project marker", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({ id: "1", identifier: "RLF-1", title: "x" });
    await linear.client.applyIndicator(issue, { type: "label", value: "ralphy:error" });
    await linear.client.applyIndicator(issue, { type: "status", value: "Conflicted" });
    await linear.client.applyIndicator(issue, { type: "project", value: "proj-1" });
    expect(linear.applied.setError).toContain("RLF-1");
    expect(linear.applied.setConflicted).toContain("RLF-1");
    const updated = linear.issues().find((i) => i.id === "1");
    expect(updated?.project?.id).toBe("proj-1");
  });

  test("removeIndicator logs clearReview", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({
      id: "1",
      identifier: "RLF-1",
      title: "x",
      labels: ["ralphy:review"],
    });
    await linear.client.removeIndicator(issue, { type: "label", value: "ralphy:review" });
    expect(linear.applied.clearReview).toContain("RLF-1");
  });

  test("fetchTodo with a comment marker picks up issues whose non-Ralph comment matches", async () => {
    const linear = createFakeLinear({
      getTodo: { filter: [{ type: "comment", value: "ralph go" }] },
    });
    linear.seed({
      id: "1",
      identifier: "RLF-1",
      title: "human asked",
      comments: [{ body: "please RALPH GO", author: "Alice" }],
    });
    linear.seed({
      id: "2",
      identifier: "RLF-2",
      title: "ralph asked itself",
      comments: [{ body: "🤖 Ralph started — ralph go", author: "ralphy" }],
    });
    linear.seed({ id: "3", identifier: "RLF-3", title: "no comments" });

    const picked = (await linear.client.fetchTodo()).map((i) => i.identifier);
    expect(picked).toEqual(["RLF-1"]);
  });

  test("setLabels / setStatus / pushComment mutate seeded issues and throw on unknown id", () => {
    const linear = createFakeLinear();
    linear.seed({ id: "1", identifier: "RLF-1", title: "x" });
    linear.setLabels("1", ["foo"]);
    linear.setStatus("1", "In Progress", "started");
    linear.pushComment("1", "hi");
    const issue = linear.issues().find((i) => i.id === "1");
    expect(issue?.labels).toEqual(["foo"]);
    expect(issue?.state.name).toBe("In Progress");
    expect(linear.comments("1")[0]?.body).toBe("hi");
    expect(() => linear.setLabels("missing", [])).toThrow("fake-linear: unknown issue");
    expect(() => linear.setStatus("missing", "x", "y")).toThrow("fake-linear: unknown issue");
  });
});
