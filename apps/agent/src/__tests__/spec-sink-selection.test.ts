/**
 * RLF-239: `wire.ts` selects the design-doc `SpecSink` by `tracker.kind` and no
 * longer hard-disables spec sync in github mode. The coordinator exposes the
 * wiring through `syncTasksEnabled` (= `commentSync.enabled`), so these tests
 * assert the gate flips on/off as expected per tracker kind without driving a
 * full poll.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { parseAgentArgs as parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "rlf239-"));
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
  // No network during build; fail loudly if anything tries.
  globalThis.fetch = (async (_input: RequestInfo | URL): Promise<Response> => {
    throw new Error("unexpected fetch during wire build");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

async function writeWorkflow(frontmatter: unknown): Promise<void> {
  await Bun.write(join(tempDir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}

const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };
const cmd: CmdRunner = { run: async () => ({ stdout: "", stderr: "" }) };

async function syncEnabled(frontmatter: unknown, apiKey: string): Promise<boolean> {
  await writeWorkflow(frontmatter);
  const cfg = await loadRalphyConfig(tempDir);
  const args = await parseArgs([]);
  const { syncTasksEnabled } = buildAgentCoordinator({
    args,
    cfg,
    projectRoot: tempDir,
    statesDir: join(tempDir, ".ralph", "tasks"),
    tasksDir: join(tempDir, "openspec", "changes"),
    apiKey,
    onLog: () => {},
    onWorkersChanged: () => {},
    onWorkerStarted: () => {},
    onWorkerExited: () => {},
    runners: {
      git,
      cmd,
      spawnWorker: () => ({ exited: Promise.resolve(0), kill: () => {} }),
      runScript: async () => 0,
    } satisfies AgentRunners,
  });
  return syncTasksEnabled;
}

const githubBlock = {
  issues: {
    repo: "acme/widgets",
    label: "ralph:todo",
    statusLabels: { inProgress: "ralph:in-progress", done: "ralph:done", error: "ralph:error" },
  },
};

describe("SpecSink selection by tracker.kind", () => {
  test("github mode wires spec sync when syncSpecsAsAttachments is on (no longer hard-disabled)", async () => {
    const enabled = await syncEnabled(
      {
        concurrency: 1,
        useWorktree: false,
        createPrOnSuccess: false,
        tracker: { kind: "github" },
        github: githubBlock,
        linear: { syncSpecsAsAttachments: true, syncTasksToComment: false },
      },
      "unused-in-github-mode",
    );
    expect(enabled).toBe(true);
  });

  test("github mode keeps spec sync off when the flag is off", async () => {
    const enabled = await syncEnabled(
      {
        concurrency: 1,
        useWorktree: false,
        createPrOnSuccess: false,
        tracker: { kind: "github" },
        github: githubBlock,
        linear: { syncSpecsAsAttachments: false, syncTasksToComment: false },
      },
      "unused-in-github-mode",
    );
    expect(enabled).toBe(false);
  });

  test("linear mode wires spec sync when syncSpecsAsAttachments is on", async () => {
    const enabled = await syncEnabled(
      {
        concurrency: 1,
        useWorktree: false,
        createPrOnSuccess: false,
        linear: { team: "ENG", syncSpecsAsAttachments: true, syncTasksToComment: false },
      },
      "fake-key",
    );
    expect(enabled).toBe(true);
  });
});
