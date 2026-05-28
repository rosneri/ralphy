import { describe, expect, test } from "bun:test";
import { getAdjacentTask } from "../FullScreenTaskView";

const tasks = [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];

describe("getAdjacentTask", () => {
  test("empty list returns null", () => {
    expect(getAdjacentTask([], "alpha", "next")).toBeNull();
    expect(getAdjacentTask([], "alpha", "prev")).toBeNull();
  });

  test("single task wraps to itself on next", () => {
    expect(getAdjacentTask([{ name: "solo" }], "solo", "next")).toBe("solo");
  });

  test("single task wraps to itself on prev", () => {
    expect(getAdjacentTask([{ name: "solo" }], "solo", "prev")).toBe("solo");
  });

  test("wrap-around prev from first item returns last", () => {
    expect(getAdjacentTask(tasks, "alpha", "prev")).toBe("gamma");
  });

  test("wrap-around next from last item returns first", () => {
    expect(getAdjacentTask(tasks, "gamma", "next")).toBe("alpha");
  });

  test("normal next navigation", () => {
    expect(getAdjacentTask(tasks, "alpha", "next")).toBe("beta");
    expect(getAdjacentTask(tasks, "beta", "next")).toBe("gamma");
  });

  test("normal prev navigation", () => {
    expect(getAdjacentTask(tasks, "gamma", "prev")).toBe("beta");
    expect(getAdjacentTask(tasks, "beta", "prev")).toBe("alpha");
  });

  test("unknown current returns null", () => {
    expect(getAdjacentTask(tasks, "unknown", "next")).toBeNull();
    expect(getAdjacentTask(tasks, "unknown", "prev")).toBeNull();
  });
});
