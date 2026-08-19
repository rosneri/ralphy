import { describe, expect, test } from "bun:test";
import { fmtElapsed, modeBadge, prLabel, trunc } from "../agent-mode-format";

describe("prLabel", () => {
  test("extracts the number from a GitHub PR URL", () => {
    expect(prLabel("https://github.com/o/r/pull/123")).toBe("#123");
  });

  test("falls back to a bare label when the URL carries no PR number", () => {
    // Any non-PR URL — the dashboard still needs something to render.
    expect(prLabel("https://github.com/o/r/issues/7")).toBe("PR");
    expect(prLabel("")).toBe("PR");
  });
});

describe("modeBadge", () => {
  test("maps each known spawn mode to its badge", () => {
    expect(modeBadge("fresh")).toEqual({ text: "NEW", color: "cyan" });
    expect(modeBadge("resume")).toEqual({ text: "RES", color: "yellow" });
    expect(modeBadge("conflict-fix")).toEqual({ text: "FIX", color: "magenta" });
  });

  test("upper-cases an unknown mode rather than dropping it", () => {
    // New trigger kinds land here before they get a dedicated badge, so the
    // dashboard shows the raw mode instead of a blank cell.
    expect(modeBadge("ci-fix")).toEqual({ text: "CI-FIX", color: "white" });
  });
});

describe("fmtElapsed", () => {
  test("renders seconds, minutes, and hours with zero-padding", () => {
    expect(fmtElapsed(45_000)).toBe("45s");
    expect(fmtElapsed(187_000)).toBe("3m07s");
    expect(fmtElapsed(7_500_000)).toBe("2h05m");
  });
});

describe("trunc", () => {
  test("shortens with an ellipsis only when over the limit", () => {
    expect(trunc("abcdef", 4)).toBe("abc…");
    expect(trunc("abc", 4)).toBe("abc");
  });
});
