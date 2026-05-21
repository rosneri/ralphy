import { describe, expect, test } from "bun:test";
import { AgentCoordinator } from "../runtime/coordinator";
import { createHarness } from "../../test/harness";

describe("harness smoke", () => {
  test("fresh-todo scenario: setInProgress → setDone, no real network", async () => {
    const h = await createHarness({ scenario: "s1.1-fresh-todo" });
    const coord = new AgentCoordinator(h.coordDeps, {
      concurrency: 1,
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "Done" },
    });

    await coord.pollOnce();
    // launchWorker runs async after pollOnce returns; wait for it to drive
    // prepare → applyIndicator → spawn before asserting.
    for (let i = 0; i < 20 && h.linear.applied.setInProgress.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(h.linear.applied.setInProgress).toContain("RLF-EX-1");

    await h.runWorkerToCompletion();
    // Give the coordinator's exit handler a chance to fire setDone.
    for (let i = 0; i < 20 && h.linear.applied.setDone.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(h.linear.applied.setDone).toContain("RLF-EX-1");

    // No real `gh` or Linear network call escaped — the fake-gh log holds
    // only scripted argv shapes (or is empty when the smoke transcript
    // didn't drive `gh` directly).
    for (const call of h.gh.calls) {
      expect(call.argv[0]).toBe("gh");
    }

    await h.cleanup();
  });
});
