import { describe, expect, test } from "bun:test";
import { createVirtualClock } from "../clock";

describe("createVirtualClock", () => {
  test("now is monotonic across advances", () => {
    const c = createVirtualClock(new Date("2025-01-01T00:00:00Z"));
    const a = c.now().getTime();
    c.advance(1000);
    const b = c.now().getTime();
    c.advance(500);
    const d = c.now().getTime();
    expect(b).toBe(a + 1000);
    expect(d).toBe(b + 500);
  });

  test("advance moves the clock forward by the requested ms", () => {
    const c = createVirtualClock(new Date(0));
    c.advance(10);
    expect(c.now().getTime()).toBe(10);
  });

  test("tick drains a pending Promise.resolve().then(...)", async () => {
    const c = createVirtualClock(new Date(0));
    let resolved = false;
    void Promise.resolve().then(() => {
      resolved = true;
    });
    await c.tick();
    expect(resolved).toBe(true);
  });
});
