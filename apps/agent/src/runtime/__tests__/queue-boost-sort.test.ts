import { describe, expect, it } from "bun:test";
import { compareByBoost } from "../coordinator";
import type { BoostBand } from "../types";

const entry = (
  boost: BoostBand,
  addedAt: number,
  id: string,
): {
  boost: BoostBand;
  addedAt: number;
  id: string;
} => ({ boost, addedAt, id });

describe("compareByBoost", () => {
  it("orders p0 ahead of higher bands", () => {
    const items = [
      entry("p2", 1, "a"),
      entry("p0", 5, "b"),
      entry("p3", 2, "c"),
      entry("p1", 3, "d"),
    ];
    const ids = [...items].sort(compareByBoost).map((e) => e.id);
    expect(ids).toEqual(["b", "d", "a", "c"]);
  });

  it("breaks ties FIFO within a band by addedAt", () => {
    const items = [entry("p1", 10, "later"), entry("p1", 5, "earlier"), entry("p1", 7, "middle")];
    const ids = [...items].sort(compareByBoost).map((e) => e.id);
    expect(ids).toEqual(["earlier", "middle", "later"]);
  });
});
