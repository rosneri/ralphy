import { describe, expect, test, mock } from "bun:test";
import { render } from "ink-testing-library";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import type { ParsedArgs } from "../cli";

mock.module("@ralphy/openspec", () => ({
  OpenSpecChangeStore: class {},
}));

// Mock for testing config loading failure
let configError: Error | null = null;
mock.module("../agent/config", () => ({
  loadRalphyConfig: async () => {
    if (configError) throw configError;
    return { enableManualTest: false };
  },
  ensureRalphyConfig: async () => "/path/to/config.json",
  RalphyConfigSchema: {},
}));

const { App } = await import("../components/App");

function withStorage<T>(fn: () => T): T {
  return runWithContext(createDefaultContext(), fn);
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
    linearTeam: "",
    linearAssignee: "",
    pollInterval: 60,
    concurrency: 1,
    worktree: false,
    indicators: {},
    createPr: false,
    fixCi: false,
    maxTickets: 0,
    ...overrides,
  };
}

describe("App misc modes", () => {
  test("init mode renders the initialized message", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-init-"));
    try {
      await withStorage(async () => {
        const args = makeArgs({ mode: "init" });
        const { frames } = render(
          <App args={args} statesDir={tempDir} tasksDir={tempDir} projectRoot={tempDir} />,
        );
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
      await withStorage(async () => {
        const args = makeArgs({ mode: "clean", name: "some-change" });
        const { frames, lastFrame } = render(
          <App args={args} statesDir={tempDir} tasksDir={tempDir} projectRoot={tempDir} />,
        );
        await new Promise((r) => setTimeout(r, 50));
        expect(frames.length).toBeGreaterThan(0);
        // Clean's render path is a no-op placeholder.
        expect(lastFrame()).not.toContain("Initialized");
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("task mode with config error shows error message", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-task-error-"));
    try {
      await withStorage(async () => {
        configError = new Error("Failed to load config");
        const args = makeArgs({ mode: "task", name: "test-change" });
        const { frames } = render(
          <App args={args} statesDir={tempDir} tasksDir={tempDir} projectRoot={tempDir} />,
        );
        await new Promise((r) => setTimeout(r, 100));
        // The error should be displayed
        expect(frames.join("\n")).toContain("Error loading config");
        configError = null;
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
