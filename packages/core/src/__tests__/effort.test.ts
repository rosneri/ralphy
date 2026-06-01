import { describe, expect, test } from "bun:test";
import {
  detectEffort,
  EFFORT_GUIDANCE,
  resolveEffortOverride,
  type Effort,
} from "../prompt/effort";
import { buildInitialState } from "../state";
import type { State } from "@ralphy/types";

function makeState(prompt: string, overrides: Partial<State> = {}): State {
  return { ...buildInitialState({ name: "test-change", prompt }), ...overrides };
}

describe("detectEffort", () => {
  test("classifies an obvious light ticket as light", () => {
    expect(detectEffort(makeState("Fix a typo in the README"))).toBe("light");
  });

  test("classifies an obvious heavy ticket as heavy", () => {
    expect(
      detectEffort(makeState("Migrate the persistence layer and refactor the coordinator")),
    ).toBe("heavy");
  });

  test("classifies an ambiguous ticket as standard", () => {
    expect(detectEffort(makeState("Add a new field to the settings panel"))).toBe("standard");
  });

  test("override wins over the heuristic", () => {
    expect(detectEffort(makeState("Fix a typo in the README"), { override: "heavy" })).toBe(
      "heavy",
    );
    expect(detectEffort(makeState("Migrate and refactor everything"), { override: "light" })).toBe(
      "light",
    );
  });

  // A mid-length (120–600 char) ambiguous prompt has no length or keyword
  // contribution, isolating the task-count signal.
  const AMBIGUOUS_MID =
    "Update the dashboard view so the settings panel shows the latest values, and make sure the surrounding labels stay readable across breakpoints.";

  test("many unchecked tasks push an ambiguous ticket to heavy", () => {
    const tasksContent = Array.from({ length: 9 }, (_, i) => `- [ ] task ${i}`).join("\n");
    expect(detectEffort(makeState(AMBIGUOUS_MID), { tasksContent })).toBe("heavy");
  });

  test("few unchecked tasks push an ambiguous ticket to light", () => {
    const tasksContent = "- [ ] only task\n- [x] already done";
    expect(detectEffort(makeState(AMBIGUOUS_MID), { tasksContent })).toBe("light");
  });

  test("empty prompt returns standard without throwing", () => {
    expect(() => detectEffort(makeState(""))).not.toThrow();
    expect(detectEffort(makeState(""))).toBe("standard");
  });

  test("tolerates a very long prompt", () => {
    const long = "word ".repeat(5000);
    expect(() => detectEffort(makeState(long))).not.toThrow();
  });

  test("is deterministic — same input yields same output", () => {
    const state = makeState("Refactor the architecture and migrate state");
    const a = detectEffort(state, { tasksContent: "- [ ] one\n- [ ] two" });
    const b = detectEffort(state, { tasksContent: "- [ ] one\n- [ ] two" });
    expect(a).toBe(b);
  });

  test("light and heavy keywords offset toward standard", () => {
    // One heavy (+2) and one light (-2) keyword net to 0 ⇒ standard.
    expect(detectEffort(makeState("Refactor the typo handling"))).toBe("standard");
  });
});

describe("EFFORT_GUIDANCE", () => {
  test("the three tiers are mutually distinct", () => {
    const tiers: Effort[] = ["light", "standard", "heavy"];
    const blocks = tiers.map((t) => EFFORT_GUIDANCE[t]);
    expect(new Set(blocks).size).toBe(3);
  });
});

describe("resolveEffortOverride", () => {
  test("auto and undefined map to undefined", () => {
    expect(resolveEffortOverride("auto")).toBeUndefined();
    expect(resolveEffortOverride(undefined)).toBeUndefined();
  });

  test("a concrete tier passes through", () => {
    expect(resolveEffortOverride("light")).toBe("light");
    expect(resolveEffortOverride("standard")).toBe("standard");
    expect(resolveEffortOverride("heavy")).toBe("heavy");
  });
});
