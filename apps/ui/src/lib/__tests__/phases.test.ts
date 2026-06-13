import { describe, expect, test } from "bun:test";
import { PHASE_COLORS, PHASES, type PhaseName } from "../phases";

describe("phases", () => {
  test("PHASES lists the lifecycle in order", () => {
    expect(PHASES).toEqual(["specify", "research", "plan", "exec", "review", "done"]);
  });

  test("every phase has a color", () => {
    for (const phase of PHASES) {
      expect(typeof PHASE_COLORS[phase]).toBe("string");
      expect(PHASE_COLORS[phase].length).toBeGreaterThan(0);
    }
  });

  test("PHASE_COLORS has no entries beyond the known phases", () => {
    const colorKeys = Object.keys(PHASE_COLORS).sort();
    expect(colorKeys).toEqual([...PHASES].sort());
  });

  test("PhaseName values index into PHASE_COLORS", () => {
    const phase: PhaseName = "exec";
    expect(PHASE_COLORS[phase]).toBe("warning");
  });
});
