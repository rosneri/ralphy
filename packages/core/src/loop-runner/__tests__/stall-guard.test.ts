import { describe, expect, test, afterEach } from "bun:test";
import { createStallGuard } from "../stall-guard";

const ENV = "RALPHY_STALL_ITERATIONS";
const orig = Bun.env[ENV];

afterEach(() => {
  if (orig === undefined) delete Bun.env[ENV];
  else Bun.env[ENV] = orig;
});

describe("createStallGuard", () => {
  test("trips after N no-progress iterations (default 3; first read is baseline)", () => {
    delete Bun.env[ENV];
    const g = createStallGuard();
    expect(g(27)).toBeNull(); // baseline
    expect(g(27)).toBeNull(); // no-progress 1
    expect(g(27)).toBeNull(); // no-progress 2
    expect(g(27)).toBe(3); // no-progress 3 → trip
  });

  test("progress resets the counter", () => {
    delete Bun.env[ENV];
    const g = createStallGuard();
    g(27); // baseline
    g(27); // no-progress 1
    expect(g(26)).toBeNull(); // dropped → reset, new baseline
    expect(g(26)).toBeNull(); // 1
    expect(g(26)).toBeNull(); // 2
    expect(g(26)).toBe(3); // 3 → trip
  });

  test("respects a configured limit", () => {
    Bun.env[ENV] = "2";
    const g = createStallGuard();
    expect(g(5)).toBeNull(); // baseline
    expect(g(5)).toBeNull(); // 1
    expect(g(5)).toBe(2); // 2 → trip
  });

  test("0 disables the guard", () => {
    Bun.env[ENV] = "0";
    const g = createStallGuard();
    for (let i = 0; i < 10; i++) expect(g(9)).toBeNull();
  });
});
