import { describe, expect, test } from "bun:test";
import { shouldFallbackToJsonOutput } from "../index";

describe("shouldFallbackToJsonOutput", () => {
  test("returns true when stdin is not a TTY and --json-output not set", () => {
    expect(shouldFallbackToJsonOutput({ jsonOutput: false }, undefined)).toBe(true);
    expect(shouldFallbackToJsonOutput({ jsonOutput: false }, false)).toBe(true);
  });

  test("returns false when stdin is a TTY", () => {
    expect(shouldFallbackToJsonOutput({ jsonOutput: false }, true)).toBe(false);
  });

  test("returns false when --json-output is already set, regardless of TTY", () => {
    expect(shouldFallbackToJsonOutput({ jsonOutput: true }, undefined)).toBe(false);
    expect(shouldFallbackToJsonOutput({ jsonOutput: true }, true)).toBe(false);
    expect(shouldFallbackToJsonOutput({ jsonOutput: true }, false)).toBe(false);
  });
});
