/**
 * The worktree setup script (`setupScript`, e.g. `make setup`) must run only
 * when a worktree is first provisioned — NOT on every resume/conflict-fix/
 * ci-fix/review re-prepare that reuses an existing worktree. `prepare` gates
 * the script on `worktreeProvider.create().created` (authoritative in worktree
 * mode), falling back to `isFresh` (first scaffold) in non-worktree mode.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { projectLayout } from "@ralphy/core/layout";
import { parseAgentArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { createPrepareHelpers } from "../agent/wire/prepare";
import { changeNameForIssue } from "../agent/scaffold";
import type { GitRunner, WorktreeProvider } from "../agent/worktree";
import type { LinearIssue } from "../shared/capabilities/linear-client";

let tempDir: string;

const ISSUE: LinearIssue = {
  id: "uuid-eng-1",
  identifier: "ENG-1",
  title: "Add dark mode",
  url: "https://linear.app/team/issue/ENG-1",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "rlf-setup-"));
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function writeWorkflow(useWorktree: boolean): Promise<void> {
  const frontmatter = {
    concurrency: 1,
    useWorktree,
    createPrOnSuccess: false,
    setupScript: "make setup",
    linear: {
      team: "ENG",
      postComments: false,
      updateEveryIterations: 0,
      indicators: {
        getTodo: { filter: [{ type: "status", value: "Todo" }] },
        setInProgress: { type: "status", value: "In Progress" },
        setDone: { type: "status", value: "Done" },
        setError: { type: "label", value: "ralph:error" },
      },
    },
  };
  await Bun.write(join(tempDir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}

function emptyMaps() {
  return {
    cwdByChange: new Map<string, string>(),
    statesDirByChange: new Map<string, string>(),
    issueByChange: new Map<string, LinearIssue>(),
    branchByChange: new Map<string, string>(),
    prByChange: new Map<string, string>(),
  };
}

const throwingGit: GitRunner = {
  run: async () => {
    throw new Error("git runner should not be called (worktree provider is injected)");
  },
};

/** A worktree provider that hands back a temp cwd and a fixed `created` flag. */
function fakeWorktreeProvider(createdFlag: boolean): WorktreeProvider {
  return {
    create: async (input) => {
      const cwd = join(tempDir, "wt", input.changeName);
      await mkdir(cwd, { recursive: true });
      return { cwd, branch: `ralph/${input.changeName}`, created: createdFlag };
    },
    seedMcpConfig: async () => {},
  };
}

/** Pre-create tasks.md inside `worktreeCwd` so `prepare` takes the resume
 *  branch (`isFresh === false`) and never reaches the scaffold/network path. */
async function seedExistingChange(worktreeCwd: string): Promise<void> {
  const layout = projectLayout(worktreeCwd);
  const changeDir = layout.changeDir(changeNameForIssue(ISSUE));
  await mkdir(changeDir, { recursive: true });
  await Bun.write(join(changeDir, "tasks.md"), "# Tasks\n\n- [ ] do the thing\n");
}

async function runPrepare(input: {
  useWorktree: boolean;
  worktreeProvider?: WorktreeProvider;
}): Promise<{ setupRuns: { cmd: string; cwd: string }[] }> {
  await writeWorkflow(input.useWorktree);
  const cfg = await loadRalphyConfig(tempDir);
  const args = await parseAgentArgs([]);
  const setupRuns: { cmd: string; cwd: string }[] = [];

  const helpers = createPrepareHelpers({
    args,
    cfg,
    projectRoot: tempDir,
    statesDir: join(tempDir, ".ralph", "tasks"),
    tasksDir: join(tempDir, "openspec", "changes"),
    apiKey: "fake-key",
    useWorktree: input.useWorktree,
    gitRunner: throwingGit,
    diag: () => {},
    maps: emptyMaps(),
    scriptRunner: async (cmd, cwd) => {
      setupRuns.push({ cmd, cwd });
      return 0;
    },
    ...(input.worktreeProvider ? { worktreeProvider: input.worktreeProvider } : {}),
  });

  await helpers.prepare(ISSUE);
  return { setupRuns };
}

describe("prepare — setup script runs once per worktree creation (not on resume)", () => {
  test("worktree freshly created → setup script runs", async () => {
    const provider = fakeWorktreeProvider(true);
    // tasks.md already present (isFresh=false) to prove `created` overrides it:
    // a recreated worktree dir has no installed deps even if the branch carries tasks.md.
    await provider.create({
      projectRoot: tempDir,
      changeName: "eng-1",
      baseBranch: "main",
      runner: throwingGit,
    });
    await seedExistingChange(join(tempDir, "wt", "eng-1"));

    const { setupRuns } = await runPrepare({ useWorktree: true, worktreeProvider: provider });

    expect(setupRuns).toHaveLength(1);
    expect(setupRuns[0]?.cmd).toBe("make setup");
    expect(setupRuns[0]?.cwd).toBe(join(tempDir, "wt", "eng-1"));
  });

  test("worktree reused (resume) → setup script is skipped", async () => {
    const provider = fakeWorktreeProvider(false);
    await provider.create({
      projectRoot: tempDir,
      changeName: "eng-1",
      baseBranch: "main",
      runner: throwingGit,
    });
    await seedExistingChange(join(tempDir, "wt", "eng-1"));

    const { setupRuns } = await runPrepare({ useWorktree: true, worktreeProvider: provider });

    expect(setupRuns).toHaveLength(0);
  });

  test("non-worktree mode, change already scaffolded → setup script is skipped", async () => {
    // worktreeCreated is null in non-worktree mode → falls back to isFresh.
    // tasks.md present in projectRoot's layout → isFresh=false → skip.
    await seedExistingChange(tempDir);

    const { setupRuns } = await runPrepare({ useWorktree: false });

    expect(setupRuns).toHaveLength(0);
  });
});
