import { describe, expect, test } from "bun:test";
import { formatTaskName } from "../state";

describe("formatTaskName", () => {
  test("trims whitespace", () => {
    expect(formatTaskName("  My Task  ")).toBe("my-task");
  });

  test("lowercases", () => {
    expect(formatTaskName("My-Task")).toBe("my-task");
  });

  test("replaces spaces with hyphens", () => {
    expect(formatTaskName("my task name")).toBe("my-task-name");
  });

  test("replaces underscores with hyphens", () => {
    expect(formatTaskName("my_task")).toBe("my-task");
  });

  test("collapses multiple hyphens", () => {
    expect(formatTaskName("my--task")).toBe("my-task");
  });

  test("handles empty string", () => {
    expect(formatTaskName("")).toBe("");
  });
});
