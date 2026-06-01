import { describe, expect, test } from "bun:test";
import {
  type OrderableIssue,
  orderIssuesHierarchically,
  rank,
} from "../ordering/hierarchical-order";

/** Build an issue with sensible defaults; override what each test cares about. */
function issue(over: Partial<OrderableIssue> & { id: string }): OrderableIssue {
  return {
    priority: 0,
    blockedByIds: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    ...over,
  };
}

function ids(issues: OrderableIssue[]): string[] {
  return issues.map((i) => i.id);
}

/** Index of an id in the ordered result. */
function pos(order: string[], id: string): number {
  return order.indexOf(id);
}

describe("rank", () => {
  test("0 and undefined sort last (Infinity); else identity", () => {
    expect(rank(0)).toBe(Number.POSITIVE_INFINITY);
    expect(rank(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(rank(1)).toBe(1);
    expect(rank(4)).toBe(4);
  });
});

describe("orderIssuesHierarchically — projects", () => {
  test("low-priority project never precedes high-priority project", () => {
    const issues = [
      issue({ id: "low", project: { id: "P2", priority: 3 } }),
      issue({ id: "high", project: { id: "P1", priority: 1 } }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(pos(order, "high")).toBeLessThan(pos(order, "low"));
  });

  test("no-project bucket ranks last", () => {
    const issues = [
      issue({ id: "none" }),
      issue({ id: "prio", project: { id: "P1", priority: 4 } }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(order).toEqual(["prio", "none"]);
  });

  test("project priority 0/undefined ranks last", () => {
    const issues = [
      issue({ id: "zero", project: { id: "P0", priority: 0 } }),
      issue({ id: "urgent", project: { id: "P1", priority: 1 } }),
      issue({ id: "undef", project: { id: "Pu" } }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(order[0]).toBe("urgent");
    expect(order.slice(1).sort()).toEqual(["undef", "zero"]);
  });

  test("dependencies are never consulted across projects (cross-project block ignored)", () => {
    // a (P2, low) is blockedBy b (P1, high) — but project order is priority-only,
    // so high-priority project P1 still comes first regardless of the block.
    const issues = [
      issue({ id: "a", project: { id: "P2", priority: 1 }, blockedByIds: ["b"] }),
      issue({ id: "b", project: { id: "P1", priority: 1 } }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    // ties on priority → project id fallback: P1 ("b") before P2 ("a"). The block
    // does not reorder across the project boundary.
    expect(order).toEqual(["b", "a"]);
  });
});

describe("orderIssuesHierarchically — milestones", () => {
  test("M2 depends on M1 ⇒ M1 first; independent earlier M3 precedes M1", () => {
    const P = { id: "P1", priority: 1 };
    const issues = [
      // M2's item is blocked by M1's item → milestone prereq M2→M1.
      issue({
        id: "m2-item",
        project: P,
        milestone: { id: "M2", sortOrder: 2 },
        blockedByIds: ["m1-item"],
      }),
      issue({ id: "m1-item", project: P, milestone: { id: "M1", sortOrder: 10 } }),
      // M3 is independent and has the smallest sortOrder.
      issue({ id: "m3-item", project: P, milestone: { id: "M3", sortOrder: 1 } }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    // M1 before M2 (derived prereq), and independent M3 (lowest sortOrder) before M1.
    expect(pos(order, "m1-item")).toBeLessThan(pos(order, "m2-item"));
    expect(pos(order, "m3-item")).toBeLessThan(pos(order, "m1-item"));
  });

  test("milestones ordered by (sortOrder, targetDate, id)", () => {
    const P = { id: "P1", priority: 1 };
    const issues = [
      issue({
        id: "b",
        project: P,
        milestone: { id: "Mb", sortOrder: 5, targetDate: "2021-02-01" },
      }),
      issue({
        id: "a",
        project: P,
        milestone: { id: "Ma", sortOrder: 5, targetDate: "2021-01-01" },
      }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(order).toEqual(["a", "b"]); // same sortOrder → earlier targetDate first
  });

  test("no-milestone bucket ranks last within a project", () => {
    const P = { id: "P1", priority: 1 };
    const issues = [
      issue({ id: "none", project: P }),
      issue({ id: "m", project: P, milestone: { id: "M1", sortOrder: 1 } }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(order).toEqual(["m", "none"]);
  });

  test("cross-milestone item block stays within milestone but lifts to a milestone prereq", () => {
    const P = { id: "P1", priority: 1 };
    const issues = [
      issue({ id: "m1-a", project: P, milestone: { id: "M1", sortOrder: 1 } }),
      issue({ id: "m1-b", project: P, milestone: { id: "M1", sortOrder: 1 } }),
      // m2-x blocked by m1-a (cross-milestone): induces M2→M1, not an item edge in M2.
      issue({
        id: "m2-x",
        project: P,
        milestone: { id: "M2", sortOrder: 2 },
        blockedByIds: ["m1-a"],
      }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(pos(order, "m1-a")).toBeLessThan(pos(order, "m2-x"));
    expect(pos(order, "m1-b")).toBeLessThan(pos(order, "m2-x"));
  });
});

describe("orderIssuesHierarchically — items", () => {
  test("B depends on A ⇒ A first; independent higher-priority C precedes A", () => {
    const P = { id: "P1", priority: 1 };
    const M = { id: "M1", sortOrder: 1 };
    const issues = [
      issue({ id: "B", project: P, milestone: M, priority: 1, blockedByIds: ["A"] }),
      issue({ id: "A", project: P, milestone: M, priority: 4 }),
      issue({ id: "C", project: P, milestone: M, priority: 1 }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    // A before B (blocker), and higher-priority C before the lower-priority A.
    expect(pos(order, "A")).toBeLessThan(pos(order, "B"));
    expect(pos(order, "C")).toBeLessThan(pos(order, "A"));
  });

  test("item priority 0/undefined ranks last among items", () => {
    const P = { id: "P1", priority: 1 };
    const M = { id: "M1", sortOrder: 1 };
    const issues = [
      issue({ id: "zero", project: P, milestone: M, priority: 0 }),
      issue({ id: "urgent", project: P, milestone: M, priority: 1 }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(order).toEqual(["urgent", "zero"]);
  });
});

describe("orderIssuesHierarchically — cycles & stability", () => {
  test("item dependency cycle is broken with a logged warning (no deadlock)", () => {
    const P = { id: "P1", priority: 1 };
    const M = { id: "M1", sortOrder: 1 };
    const warnings: string[] = [];
    const issues = [
      issue({ id: "A", project: P, milestone: M, blockedByIds: ["B"] }),
      issue({ id: "B", project: P, milestone: M, blockedByIds: ["A"] }),
    ];
    const order = ids(orderIssuesHierarchically(issues, { log: (m) => warnings.push(m) }));
    expect(order.sort()).toEqual(["A", "B"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("cycle"))).toBe(true);
  });

  test("milestone dependency cycle is broken with a logged warning", () => {
    const P = { id: "P1", priority: 1 };
    const warnings: string[] = [];
    const issues = [
      issue({ id: "m1", project: P, milestone: { id: "M1", sortOrder: 1 }, blockedByIds: ["m2"] }),
      issue({ id: "m2", project: P, milestone: { id: "M2", sortOrder: 2 }, blockedByIds: ["m1"] }),
    ];
    const order = ids(orderIssuesHierarchically(issues, { log: (m) => warnings.push(m) }));
    expect(order.length).toBe(2);
    expect(warnings.some((w) => w.includes("milestone") && w.includes("cycle"))).toBe(true);
  });

  test("stable, deterministic order on full ties (priority, createdAt, id)", () => {
    const P = { id: "P1", priority: 1 };
    const M = { id: "M1", sortOrder: 1 };
    const issues = [
      issue({ id: "c", project: P, milestone: M }),
      issue({ id: "a", project: P, milestone: M }),
      issue({ id: "b", project: P, milestone: M }),
    ];
    const first = ids(orderIssuesHierarchically(issues));
    const second = ids(orderIssuesHierarchically([...issues].reverse()));
    expect(first).toEqual(["a", "b", "c"]); // id fallback
    expect(second).toEqual(first); // reproducible regardless of input order
  });

  test("createdAt breaks ties before id", () => {
    const P = { id: "P1", priority: 1 };
    const M = { id: "M1", sortOrder: 1 };
    const issues = [
      issue({ id: "z", project: P, milestone: M, createdAt: "2020-01-01T00:00:00.000Z" }),
      issue({ id: "a", project: P, milestone: M, createdAt: "2020-06-01T00:00:00.000Z" }),
    ];
    const order = ids(orderIssuesHierarchically(issues));
    expect(order).toEqual(["z", "a"]); // earlier createdAt wins over id
  });

  test("empty and single-element inputs are returned as-is", () => {
    expect(orderIssuesHierarchically([])).toEqual([]);
    const one = [issue({ id: "solo" })];
    expect(ids(orderIssuesHierarchically(one))).toEqual(["solo"]);
  });
});
