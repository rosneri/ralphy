import { describe, expect, test } from "bun:test";
import { MAX_LOG_VIEWPORT_LINES, visibleLogWindow } from "../components/AgentMode";

describe("AgentMode log viewport", () => {
  test("returns all lines when below the cap (box grows with input)", () => {
    const lines = ["a", "b", "c"];
    expect(visibleLogWindow(lines)).toEqual(lines);
  });

  test("tails to the cap once the viewport fills", () => {
    const lines = Array.from({ length: MAX_LOG_VIEWPORT_LINES + 7 }, (_, i) => `line-${i}`);
    const visible = visibleLogWindow(lines);
    expect(visible.length).toBe(MAX_LOG_VIEWPORT_LINES);
    expect(visible[0]).toBe(`line-7`);
    expect(visible[visible.length - 1]).toBe(`line-${lines.length - 1}`);
  });

  test("respects an explicit cap argument", () => {
    const lines = ["a", "b", "c", "d", "e"];
    expect(visibleLogWindow(lines, 2)).toEqual(["d", "e"]);
  });

  test("empty input yields empty output", () => {
    expect(visibleLogWindow([])).toEqual([]);
  });
});
