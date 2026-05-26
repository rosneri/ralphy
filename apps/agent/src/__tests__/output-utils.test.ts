import { describe, expect, test } from "bun:test";
import { cleanOutputLine } from "../shared/capabilities/output-utils";

describe("cleanOutputLine", () => {
  test("returns null for empty string", () => {
    expect(cleanOutputLine("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(cleanOutputLine("   ")).toBeNull();
  });

  test("returns null for ANSI-only string that becomes empty after strip", () => {
    expect(cleanOutputLine("\x1b[32m\x1b[0m")).toBeNull();
  });

  test("strips ANSI escape sequences from non-empty content", () => {
    expect(cleanOutputLine("\x1b[32mhello\x1b[0m")).toBe("hello");
  });

  test("returns null for box-drawing-only lines", () => {
    expect(cleanOutputLine("───────────────────")).toBeNull();
    expect(cleanOutputLine("╭──────╮")).toBeNull();
    expect(cleanOutputLine("│      │")).toBeNull();
    expect(cleanOutputLine("╰──────╯")).toBeNull();
  });

  test("returns null for status bar spinner lines", () => {
    expect(cleanOutputLine("⠋ iter 1")).toBeNull();
    expect(cleanOutputLine("✓ iter 42")).toBeNull();
    expect(cleanOutputLine("✗ iter 3")).toBeNull();
  });

  test("returns null for iteration header lines starting with ──", () => {
    expect(cleanOutputLine("── Iteration 1 ──")).toBeNull();
  });

  test("returns cleaned content for regular lines", () => {
    expect(cleanOutputLine("hello world")).toBe("hello world");
  });

  test("trims surrounding whitespace", () => {
    expect(cleanOutputLine("  hello  ")).toBe("hello");
  });
});
