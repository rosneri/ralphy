import { describe, expect, test } from "bun:test";
import { isStaleSignal } from "../detections/stale";

const BASE_NOW = 1_000_000_000_000; // fixed epoch ms for all tests

describe("isStaleSignal", () => {
  test("null updatedAt → false (unknown age, not stale)", () => {
    expect(isStaleSignal({ updatedAt: null, nowMs: BASE_NOW, ttlMs: 0 })).toBe(false);
  });

  test("age < ttl → false", () => {
    const updatedAt = new Date(BASE_NOW - 30_000).toISOString(); // 30s ago
    expect(isStaleSignal({ updatedAt, nowMs: BASE_NOW, ttlMs: 60_000 })).toBe(false);
  });

  test("age === ttl → false (exclusive boundary)", () => {
    const updatedAt = new Date(BASE_NOW - 60_000).toISOString(); // exactly 60s ago
    expect(isStaleSignal({ updatedAt, nowMs: BASE_NOW, ttlMs: 60_000 })).toBe(false);
  });

  test("age > ttl → true", () => {
    const updatedAt = new Date(BASE_NOW - 120_000).toISOString(); // 120s ago
    expect(isStaleSignal({ updatedAt, nowMs: BASE_NOW, ttlMs: 60_000 })).toBe(true);
  });

  test("future updatedAt (negative age) → false", () => {
    const updatedAt = new Date(BASE_NOW + 10_000).toISOString(); // 10s in the future
    expect(isStaleSignal({ updatedAt, nowMs: BASE_NOW, ttlMs: 0 })).toBe(false);
  });
});
