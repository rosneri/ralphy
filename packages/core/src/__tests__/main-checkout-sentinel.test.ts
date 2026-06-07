import { describe, expect, test } from "bun:test";
import {
  detectCheckoutLeak,
  snapshotCheckout,
  type CheckoutSnapshot,
  type GitStatusRunner,
} from "../main-checkout-sentinel";

const EMPTY: CheckoutSnapshot = { head: "", entries: [] };

function snap(head: string, entries: string[]): CheckoutSnapshot {
  return { head, entries };
}

describe("detectCheckoutLeak", () => {
  test("clean → clean: no leak", () => {
    const leak = detectCheckoutLeak(snap("abc", []), snap("abc", []));
    expect(leak.leaked).toBe(false);
    expect(leak.headMoved).toBe(false);
    expect(leak.newEntries).toEqual([]);
  });

  test("clean → one new entry: leak names the new path", () => {
    const leak = detectCheckoutLeak(snap("abc", []), snap("abc", [" M src/a.ts"]));
    expect(leak.leaked).toBe(true);
    expect(leak.headMoved).toBe(false);
    expect(leak.newEntries).toEqual([" M src/a.ts"]);
  });

  test("pre-dirty → same entry: developer's own dirt is not a leak", () => {
    const before = snap("abc", [" M src/dev.ts"]);
    const after = snap("abc", [" M src/dev.ts"]);
    const leak = detectCheckoutLeak(before, after);
    expect(leak.leaked).toBe(false);
    expect(leak.newEntries).toEqual([]);
  });

  test("pre-dirty → pre-dirty plus a new entry: only the new entry counts", () => {
    const before = snap("abc", [" M src/dev.ts"]);
    const after = snap("abc", [" M src/dev.ts", " M src/leak.ts"]);
    const leak = detectCheckoutLeak(before, after);
    expect(leak.leaked).toBe(true);
    expect(leak.newEntries).toEqual([" M src/leak.ts"]);
  });

  test("HEAD A → HEAD B: headMoved leak even with a clean tree", () => {
    const leak = detectCheckoutLeak(snap("aaa", []), snap("bbb", []));
    expect(leak.leaked).toBe(true);
    expect(leak.headMoved).toBe(true);
    expect(leak.newEntries).toEqual([]);
  });

  test("empty sentinel on the before side: no alarm (fail open)", () => {
    const leak = detectCheckoutLeak(EMPTY, snap("abc", [" M src/a.ts"]));
    expect(leak.leaked).toBe(false);
    expect(leak.headMoved).toBe(false);
  });

  test("empty sentinel on the after side: no alarm (fail open)", () => {
    const leak = detectCheckoutLeak(snap("abc", [" M src/a.ts"]), EMPTY);
    expect(leak.leaked).toBe(false);
    expect(leak.headMoved).toBe(false);
  });
});

describe("snapshotCheckout", () => {
  test("parses porcelain into trimmed, sorted entries", async () => {
    const runner: GitStatusRunner = {
      run: async (args) => {
        if (args[0] === "rev-parse") return { stdout: "deadbeef\n", stderr: "" };
        if (args[0] === "status") {
          return { stdout: " M src/z.ts\n?? src/a.ts\n M src/m.ts\n", stderr: "" };
        }
        throw new Error("unexpected git command");
      },
    };
    const snapshot = await snapshotCheckout("/root", runner);
    expect(snapshot.head).toBe("deadbeef");
    // Lines are trimmed (leading porcelain status space dropped) and sorted.
    expect(snapshot.entries).toEqual(["?? src/a.ts", "M src/m.ts", "M src/z.ts"]);
  });

  test("degrades to the empty sentinel when the runner throws", async () => {
    const runner: GitStatusRunner = {
      run: async () => {
        throw new Error("not a git repository");
      },
    };
    const snapshot = await snapshotCheckout("/root", runner);
    expect(snapshot).toEqual({ head: "", entries: [] });
  });
});
