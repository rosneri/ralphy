import { describe, expect, test, mock } from "bun:test";
import { render } from "ink-testing-library";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import type { ProjectLayout } from "@ralphy/types";
import type { LoopParsedArgs as ParsedArgs } from "../cli";

mock.module("@ralphy/openspec", () => ({
  OpenSpecChangeStore: class {},
}));

const { App } = await import("../components/App");

function makeTestLayout(dir: string): ProjectLayout {
  return {
    root: dir,
    statesDir: dir,
    tasksDir: dir,
    agentStateFile: join(dir, "agent-state.json"),
    changeDir: (name) => join(dir, name),
    taskStateDir: (name) => join(dir, name),
    stateFile: (name) => join(dir, name, ".ralph-state.json"),
  };
}

function withLayout<T>(dir: string, fn: () => T): T {
  return runWithContext(createDefaultContext({ layout: makeTestLayout(dir) }), fn);
}

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    mode: "task",
    name: "",
    prompt: "",
    engine: "claude",
    model: "opus",
    engineSet: false,
    maxIterations: 0,
    maxCostUsd: 0,
    maxRuntimeMinutes: 0,
    maxConsecutiveFailures: 5,
    delay: 0,
    log: false,
    verbose: false,
    manualTest: false,
    fromAgent: false,
    reviewPhase: { enabled: false, maxRounds: 1, reviewerContextStrategy: "fresh" },
    ...overrides,
  };
}

describe("App misc modes", () => {
  test("init mode renders the initialized message", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-init-"));
    try {
      await withLayout(tempDir, async () => {
        const args = makeArgs({ mode: "init" });
        const { frames } = render(<App args={args} />);
        await new Promise((r) => setTimeout(r, 50));
        expect(frames.join("\n")).toContain("Initialized openspec directory");
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("clean mode renders an empty placeholder (handled before render)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-clean-"));
    try {
      await withLayout(tempDir, async () => {
        const args = makeArgs({ mode: "clean", name: "some-change" });
        const { frames, lastFrame } = render(<App args={args} />);
        await new Promise((r) => setTimeout(r, 50));
        expect(frames.length).toBeGreaterThan(0);
        // Clean's render path is a no-op placeholder.
        expect(lastFrame()).not.toContain("Initialized");
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
