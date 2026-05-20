import { describe, expect, test } from "bun:test";
import { createRing } from "../ring";

describe("ring", () => {
  test("snapshot returns entries in chronological order while under capacity", () => {
    const r = createRing<number>(5);
    r.push(1);
    r.push(2);
    r.push(3);
    expect(r.snapshot()).toEqual([1, 2, 3]);
  });

  test("overwrites oldest entry when full", () => {
    const r = createRing<number>(3);
    r.push(1);
    r.push(2);
    r.push(3);
    r.push(4);
    r.push(5);
    expect(r.snapshot()).toEqual([3, 4, 5]);
  });

  test("clear() empties the ring", () => {
    const r = createRing<number>(3);
    r.push(1);
    r.clear();
    expect(r.snapshot()).toEqual([]);
    r.push(9);
    expect(r.snapshot()).toEqual([9]);
  });

  test("rejects non-positive capacity", () => {
    expect(() => createRing<number>(0)).toThrow();
  });
});
