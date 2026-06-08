import { describe, expect, test } from "bun:test";
import { createFakeLinear } from "../fake-linear";

// The backend-neutral provider surface (fetch filtering, comment/mention
// round-trips, apply/remove logging, lifecycle exclusion, additive setPrReady)
// is asserted by the shared kit in `provider-contract.ts` and driven against
// FakeLinear from `apps/agent/src/__tests__/provider-contract.test.ts`. The
// cases below cover only FakeLinear-internal behavior the kit does not reach:
// its specific marker-classification vocabulary, project-marker handling, the
// comment-marker `fetchTodo` path, and the seed-mutation helpers.
describe("createFakeLinear", () => {
  test("RLF-214: setPrReady label marker (ralphy:pr-ready) is bucketed before setInProgress", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({ id: "1", identifier: "RLF-1", title: "x" });
    await linear.client.applyIndicator(issue, { type: "label", value: "ralphy:pr-ready" });
    expect(linear.applied.setPrReady).toContain("RLF-1");
    expect(linear.applied.setInProgress).not.toContain("RLF-1");
  });

  test("applyIndicator classifies setError and project marker", async () => {
    const linear = createFakeLinear();
    const issue = linear.seed({ id: "1", identifier: "RLF-1", title: "x" });
    await linear.client.applyIndicator(issue, { type: "label", value: "ralphy:error" });
    await linear.client.applyIndicator(issue, { type: "project", value: "proj-1" });
    expect(linear.applied.setError).toContain("RLF-1");
    const updated = linear.issues().find((i) => i.id === "1");
    expect(updated?.project?.id).toBe("proj-1");
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
