import { describe, expect, test } from "bun:test";
import { getScenario, registry } from "../scenarios";

describe("scenarios registry", () => {
  test("returns the s1.1-fresh-todo scenario", () => {
    expect(getScenario("s1.1-fresh-todo")).toBe(registry["s1.1-fresh-todo"]);
  });

  test("throws on unknown scenario with cause carrying name + registered list", () => {
    try {
      getScenario("nope");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("harness: unknown scenario");
      const cause = (err as Error).cause as { name: string; registered: string[] };
      expect(cause.name).toBe("nope");
      expect(cause.registered).toContain("s1.1-fresh-todo");
    }
  });
});
