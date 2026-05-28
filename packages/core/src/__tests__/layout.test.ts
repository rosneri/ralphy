import { describe, expect, test } from "bun:test";
import { projectLayout, layoutFromContext } from "../layout";
import { runWithContext, createFileSystemProvider } from "@ralphy/context";

describe("projectLayout", () => {
  test("derives all paths from a single root", () => {
    const l = projectLayout("/tmp/proj");
    expect(l.root).toBe("/tmp/proj");
    expect(l.statesDir).toBe("/tmp/proj/.ralph/tasks");
    expect(l.tasksDir).toBe("/tmp/proj/openspec/changes");
    expect(l.agentStateFile).toBe("/tmp/proj/.ralph/agent-state.json");
    expect(l.changeDir("foo")).toBe("/tmp/proj/openspec/changes/foo");
    expect(l.taskStateDir("foo")).toBe("/tmp/proj/.ralph/tasks/foo");
    expect(l.stateFile("foo")).toBe("/tmp/proj/.ralph/tasks/foo/.ralph-state.json");
  });

  test("works for worktree roots (same shape, different root)", () => {
    const l = projectLayout("/Users/me/.ralph/proj/worktrees/eng-1");
    expect(l.changeDir("eng-1")).toBe(
      "/Users/me/.ralph/proj/worktrees/eng-1/openspec/changes/eng-1",
    );
    expect(l.stateFile("eng-1")).toBe(
      "/Users/me/.ralph/proj/worktrees/eng-1/.ralph/tasks/eng-1/.ralph-state.json",
    );
  });
});

describe("layoutFromContext", () => {
  test("returns layout from context", () => {
    const layout = projectLayout("/tmp/ctx-proj");
    runWithContext({ storage: createFileSystemProvider(), layout }, () => {
      const result = layoutFromContext();
      expect(result.root).toBe("/tmp/ctx-proj");
      expect(result.statesDir).toBe("/tmp/ctx-proj/.ralph/tasks");
    });
  });
});
