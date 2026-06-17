// End-to-end chaining proof for the prDraft "draft until done" flow.
//
// Gap this closes: each half is unit-tested in isolation (createOpenDraftPr
// *opens* a draft PR at design-ready; runPrPhase *readies* an existing PR at the
// end), but nothing proved they connect — that the very PR opened early is the
// one post-task later flips to ready. This drives BOTH real functions over a
// single stateful GitHub mock and asserts: one PR is created (as a draft) at the
// park point, the end-of-run PR phase reuses that same URL (no second create),
// and it is flipped draft -> ready once CI is green.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPrPhase } from "../agent/post-task";
import { createOpenDraftPr } from "../agent/wire/pr-helpers";
import type { CmdRunner } from "../agent/pr";
import { createGhCliCodeHost } from "@ralphy/codehost";
const ghHost = (cmd: CmdRunner) => createGhCliCodeHost({ cmdRunner: cmd, cwd: "/wt" });
import type { TrackedIssue } from "@ralphy/tracker";

const ISSUE: TrackedIssue = {
  id: "u-1",
  identifier: "ENG-42",
  title: "Add feature",
  description: "Why and what.",
  url: "https://linear.app/x/issue/ENG-42",
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
  priority: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
};

/**
 * A single stateful fake of `git` + `gh` shared across both halves of the flow.
 * Models one PR per branch with a draft flag so the end-of-run phase observes
 * exactly what the early open created.
 */
function makeGitHub(opts: { hasCommits?: boolean } = {}) {
  const hasCommits = opts.hasCommits ?? true;
  const prUrlByBranch = new Map<string, string>();
  const draftByUrl = new Map<string, boolean>();
  const readyCalls: string[] = [];
  const createCalls: string[][] = [];
  const calls: string[][] = [];
  let lastPushedBranch: string | null = null;
  let nextPr = 900;

  const cmd: CmdRunner = {
    run: async (args) => {
      calls.push([...args]);
      const key = args.join(" ");

      if (key.startsWith("git push")) {
        // `git push -u origin <branch>` — remember which branch a create targets.
        const i = args.indexOf("origin");
        if (i >= 0 && args[i + 1]) lastPushedBranch = args[i + 1]!;
        return { stdout: "", stderr: "" };
      }
      // `git log --oneline <base>..HEAD` — empty ⇒ nothing committed to PR yet.
      if (key.startsWith("git log")) {
        return { stdout: hasCommits ? "abc committed design + work" : "", stderr: "" };
      }
      if (key.startsWith("git diff")) return { stdout: "", stderr: "" };
      if (key.startsWith("git status --porcelain")) return { stdout: "", stderr: "" };

      if (key.startsWith("gh pr list")) {
        // createPullRequest's existing-PR probe: `gh pr list --head <branch> ...`
        const i = args.indexOf("--head");
        const branch = i >= 0 ? args[i + 1] : undefined;
        const url = branch ? (prUrlByBranch.get(branch) ?? "") : "";
        return { stdout: url, stderr: "" };
      }
      if (key.startsWith("gh pr create")) {
        createCalls.push([...args]);
        const url = `https://github.com/owner/repo/pull/${nextPr++}`;
        if (lastPushedBranch) prUrlByBranch.set(lastPushedBranch, url);
        draftByUrl.set(url, args.includes("--draft"));
        return { stdout: url, stderr: "" };
      }
      if (key.startsWith("gh pr checks")) {
        return { stdout: JSON.stringify([{ name: "CI", bucket: "pass" }]), stderr: "" };
      }
      if (key.startsWith("gh pr ready")) {
        const url = args[3]!;
        draftByUrl.set(url, false);
        readyCalls.push(url);
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  };

  return { cmd, prUrlByBranch, draftByUrl, readyCalls, createCalls, calls };
}

describe("e2e — prDraft chain: design-ready draft → readied at end (same PR)", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "e2e-draft-chain-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("the early draft PR is the same PR post-task flips to ready", async () => {
    const branch = "ralph/my-change";
    const gh = makeGitHub();

    // --- Half 1: design-ready / park point → open the early DRAFT PR ---
    const open = createOpenDraftPr({
      branchByChange: new Map([["my-change", branch]]),
      prByChange: new Map<string, string>(),
      cmdRunner: gh.cmd,
      prBaseBranch: "main",
      invalidatePrUrlForIssue: () => {},
    });
    const earlyUrl = await open(ISSUE, "my-change", tmpDir);

    expect(earlyUrl).not.toBeNull();
    expect(gh.createCalls.length).toBe(1);
    expect(gh.createCalls[0]).toContain("--draft");
    expect(gh.draftByUrl.get(earlyUrl!)).toBe(true); // it's a draft right now
    expect(gh.readyCalls).toHaveLength(0); // not readied yet

    // --- Half 2: implementation done + CI green → post-task PR phase ---
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch,
        changeDir,
        stateFilePath,
        issue: ISSUE,
        wantAutoMerge: false,
        config: {
          teardownScript: null,
          prBaseBranch: "main",
          autoMergeStrategy: "squash" as const,
          cleanupWorktreeOnSuccess: false,
          stackPrsOnDependencies: false,
          neverTouch: [],
          prDraft: true,
        },
      },
      {
        cmd: gh.cmd,
        codeHost: ghHost(gh.cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    // The chain: NO second PR was created — post-task reused the early PR…
    expect(gh.createCalls.length).toBe(1);
    // …and it readied that exact same URL.
    expect(gh.readyCalls).toEqual([earlyUrl!]);
    expect(gh.draftByUrl.get(earlyUrl!)).toBe(false); // now ready, no longer a draft
  });

  test("graceful fallback: design not committed at park → no early PR, opened at end instead", async () => {
    const branch = "ralph/my-change";
    // Half 1: at the park point the design isn't committed yet (git log empty).
    const ghEarly = makeGitHub({ hasCommits: false });
    const open = createOpenDraftPr({
      branchByChange: new Map([["my-change", branch]]),
      prByChange: new Map<string, string>(),
      cmdRunner: ghEarly.cmd,
      prBaseBranch: "main",
      invalidatePrUrlForIssue: () => {},
    });
    const earlyUrl = await open(ISSUE, "my-change", tmpDir);

    expect(earlyUrl).toBeNull(); // nothing to PR yet
    expect(ghEarly.createCalls.length).toBe(0); // no early PR opened

    // Half 2: by end-of-run the work is committed → post-task opens the PR fresh
    // (not a draft this time? it still passes draft:true, but it's a NEW create).
    const ghEnd = makeGitHub({ hasCommits: true });
    const code = await runPrPhase(
      {
        changeName: "my-change",
        cwd: tmpDir,
        branch,
        changeDir,
        stateFilePath,
        issue: ISSUE,
        wantAutoMerge: false,
        config: {
          teardownScript: null,
          prBaseBranch: "main",
          autoMergeStrategy: "squash" as const,
          cleanupWorktreeOnSuccess: false,
          stackPrsOnDependencies: false,
          neverTouch: [],
          prDraft: true,
        },
      },
      {
        cmd: ghEnd.cmd,
        codeHost: ghHost(ghEnd.cmd),
        log: () => {},
        emit: () => {},
        respawnWorker: async () => 0,
      },
    );

    expect(code).toBe(0);
    // The PR was opened at the end (the fallback) and then readied.
    expect(ghEnd.createCalls.length).toBe(1);
    expect(ghEnd.readyCalls).toHaveLength(1);
  });
});
