import { describe, expect, test } from "bun:test";
import { createPullRequest, type CmdRunner } from "../agent/pr";
import type { TrackedIssue } from "@ralphy/tracker";

const issue: TrackedIssue = {
  id: "u1",
  identifier: "ENG-7",
  title: "Add feature",
  description: "Some details.",
  url: "https://linear.app/x/issue/ENG-7",
  state: { name: "Todo", type: "unstarted" },
  assignee: null,
  project: null,
  labels: [],
  priority: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
};

interface ResponseSpec {
  stdout?: string;
  stderr?: string;
  throw?: boolean;
}

function makeRunner(responses: Record<string, ResponseSpec>): {
  runner: CmdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (cmd, _cwd) => {
      calls.push(cmd);
      // Match by command type — the test specs key on the first 3-4 tokens.
      let matched: ResponseSpec | undefined;
      for (const [key, r] of Object.entries(responses)) {
        if (cmd.join(" ").startsWith(key)) {
          matched = r;
          break;
        }
      }
      if (matched?.throw) throw new Error("cmd failed");
      return { stdout: matched?.stdout ?? "", stderr: matched?.stderr ?? "" };
    },
  };
  return { runner, calls };
}

describe("createPullRequest", () => {
  test("returns null when there are no commits ahead of base", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "" },
    });
    const result = await createPullRequest({ cwd: "/wt", branch: "ralph/eng-7", issue }, runner);
    expect(result).toBeNull();
    // Should NOT have pushed or called gh.
    expect(calls.find((c) => c[0] === "git" && c[1] === "push")).toBeUndefined();
    expect(calls.find((c) => c[0] === "gh")).toBeUndefined();
  });

  test("opens a new PR when none exists", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/123\n" },
    });
    const result = await createPullRequest({ cwd: "/wt", branch: "ralph/eng-7", issue }, runner);
    expect(result).toEqual({ url: "https://github.com/foo/bar/pull/123", created: true });
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall).toBeDefined();
    expect(createCall.includes("--title")).toBe(true);
    expect(createCall[createCall.indexOf("--title") + 1]).toBe("ENG-7: Add feature");
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("main");
  });

  test("returns existing PR URL idempotently when one already exists", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc x\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "https://github.com/foo/bar/pull/9\n" },
    });
    const result = await createPullRequest({ cwd: "/wt", branch: "ralph/eng-7", issue }, runner);
    expect(result).toEqual({ url: "https://github.com/foo/bar/pull/9", created: false });
    expect(calls.find((c) => c[0] === "gh" && c[2] === "create")).toBeUndefined();
  });

  test("respects custom base branch", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline release/2024..HEAD": { stdout: "abc x\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/77\n" },
    });
    await createPullRequest(
      { cwd: "/wt", branch: "ralph/eng-7", issue, base: "release/2024" },
      runner,
    );
    const createCall = calls.find((c) => c[0] === "gh" && c[2] === "create")!;
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("release/2024");
  });

  test("opens PR when diff against base contains a substantive (non-meta) file", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git diff --name-only origin/main...HEAD": {
        stdout: "openspec/changes/x/tasks.md\nsrc/feature.ts\n",
      },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/1\n" },
    });
    const result = await createPullRequest(
      {
        cwd: "/wt",
        branch: "ralph/eng-7",
        issue,
        metaOnlyFiles: ["openspec/**", "**/tasks.md"],
      },
      runner,
    );
    expect(result).toEqual({ url: "https://github.com/foo/bar/pull/1", created: true });
    expect(calls.some((c) => c[0] === "gh" && c[2] === "create")).toBe(true);
  });

  test("blocks PR with only-meta when the diff against base is meta-only", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git diff --name-only origin/main...HEAD": {
        stdout: "openspec/changes/x/tasks.md\nopenspec/changes/x/agent-tasks.md\n",
      },
    });
    const result = await createPullRequest(
      {
        cwd: "/wt",
        branch: "ralph/eng-7",
        issue,
        metaOnlyFiles: ["openspec/**", "**/agent-tasks.md", "**/tasks.md"],
      },
      runner,
    );
    expect(result).toEqual({
      url: null,
      created: false,
      blocked: "only-meta",
      blockedFiles: ["openspec/changes/x/tasks.md", "openspec/changes/x/agent-tasks.md"],
    });
    // Push and gh pr create must NOT be invoked when blocked.
    expect(calls.find((c) => c[0] === "git" && c[1] === "push")).toBeUndefined();
    expect(calls.find((c) => c[0] === "gh" && c[2] === "create")).toBeUndefined();
  });

  test("returns null when only-meta but a merged PR exists for the branch", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git diff --name-only origin/main...HEAD": {
        stdout: "openspec/changes/x/tasks.md\n",
      },
      "gh pr list --head ralph/eng-7 --state merged": { stdout: "328\n" },
    });
    const result = await createPullRequest(
      {
        cwd: "/wt",
        branch: "ralph/eng-7",
        issue,
        metaOnlyFiles: ["openspec/**", "**/tasks.md"],
      },
      runner,
    );
    expect(result).toBeNull();
    // Must not block (no fix-task respawn) and must not push.
    expect(calls.find((c) => c[0] === "git" && c[1] === "push")).toBeUndefined();
    expect(calls.find((c) => c[0] === "gh" && c[2] === "create")).toBeUndefined();
  });

  test("returns null when only-meta and git cherry shows all commits already on base", async () => {
    const { runner } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git diff --name-only origin/main...HEAD": {
        stdout: "openspec/changes/x/tasks.md\n",
      },
      // No merged PR found.
      "gh pr list --head ralph/eng-7 --state merged": { stdout: "" },
      // Every line starts with "-" → already in base.
      "git cherry main HEAD": { stdout: "- 1111111111111111111111111111111111111111\n" },
    });
    const result = await createPullRequest(
      {
        cwd: "/wt",
        branch: "ralph/eng-7",
        issue,
        metaOnlyFiles: ["openspec/**", "**/tasks.md"],
      },
      runner,
    );
    expect(result).toBeNull();
  });

  test("falls back to local <base>...HEAD when origin/<base> is not available", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc x\n" },
      "git diff --name-only origin/main...HEAD": { throw: true },
      "git diff --name-only main...HEAD": { stdout: "openspec/x/tasks.md\n" },
    });
    const result = await createPullRequest(
      {
        cwd: "/wt",
        branch: "ralph/eng-7",
        issue,
        metaOnlyFiles: ["openspec/**", "**/tasks.md"],
      },
      runner,
    );
    expect(result?.blocked).toBe("only-meta");
    expect(calls.some((c) => c.join(" ") === "git diff --name-only main...HEAD")).toBe(true);
  });

  test("honors custom metaOnlyFiles entries", async () => {
    const { runner } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc x\n" },
      "git diff --name-only origin/main...HEAD": { stdout: "docs/notes.md\n" },
    });
    const result = await createPullRequest(
      {
        cwd: "/wt",
        branch: "ralph/eng-7",
        issue,
        metaOnlyFiles: ["docs/**"],
      },
      runner,
    );
    expect(result?.blocked).toBe("only-meta");
    expect(result?.blockedFiles).toEqual(["docs/notes.md"]);
  });

  test("passes --draft to gh pr create when draft: true", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/99\n" },
    });
    const result = await createPullRequest(
      { cwd: "/wt", branch: "ralph/eng-7", issue, draft: true },
      runner,
    );
    expect(result).toEqual({ url: "https://github.com/foo/bar/pull/99", created: true });
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall).toBeDefined();
    expect(createCall).toContain("--draft");
  });

  test("does not pass --draft to gh pr create when draft: false", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/100\n" },
    });
    await createPullRequest({ cwd: "/wt", branch: "ralph/eng-7", issue, draft: false }, runner);
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall).toBeDefined();
    expect(createCall).not.toContain("--draft");
  });

  test("attaches configured labels via gh pr edit after creating the PR", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/123\n" },
      "gh pr edit": { stdout: "" },
    });
    const result = await createPullRequest(
      { cwd: "/wt", branch: "ralph/eng-7", issue, labels: ["ralph", "automated"] },
      runner,
    );
    expect(result).toEqual({ url: "https://github.com/foo/bar/pull/123", created: true });
    const editCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "edit")!;
    expect(editCall).toBeDefined();
    expect(editCall[3]).toBe("https://github.com/foo/bar/pull/123");
    expect(editCall[editCall.indexOf("--add-label") + 1]).toBe("ralph,automated");
  });

  test("still returns a created PR when label application fails", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/55\n" },
      "gh pr edit": { throw: true },
    });
    const result = await createPullRequest(
      { cwd: "/wt", branch: "ralph/eng-7", issue, labels: ["does-not-exist"] },
      runner,
    );
    // The PR is the artifact; a failed label edit must not lose it.
    expect(result).toEqual({ url: "https://github.com/foo/bar/pull/55", created: true });
    expect(calls.some((c) => c[0] === "gh" && c[2] === "edit")).toBe(true);
  });

  test("applies labels to an existing PR idempotently", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc x\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "https://github.com/foo/bar/pull/9\n" },
      "gh pr edit": { stdout: "" },
    });
    const result = await createPullRequest(
      { cwd: "/wt", branch: "ralph/eng-7", issue, labels: ["ralph"] },
      runner,
    );
    expect(result).toEqual({ url: "https://github.com/foo/bar/pull/9", created: false });
    const editCall = calls.find((c) => c[0] === "gh" && c[2] === "edit")!;
    expect(editCall[3]).toBe("https://github.com/foo/bar/pull/9");
    expect(editCall[editCall.indexOf("--add-label") + 1]).toBe("ralph");
    // Must not open a second PR.
    expect(calls.find((c) => c[0] === "gh" && c[2] === "create")).toBeUndefined();
  });

  test("ignores blank label entries and skips gh pr edit when none remain", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/3\n" },
    });
    await createPullRequest(
      { cwd: "/wt", branch: "ralph/eng-7", issue, labels: ["", "  "] },
      runner,
    );
    expect(calls.find((c) => c[0] === "gh" && c[2] === "edit")).toBeUndefined();
  });

  test("does not call gh pr edit when no labels are configured", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc Some commit\n" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/foo/bar/pull/1\n" },
    });
    await createPullRequest({ cwd: "/wt", branch: "ralph/eng-7", issue }, runner);
    expect(calls.find((c) => c[0] === "gh" && c[2] === "edit")).toBeUndefined();
  });

  test("propagates push failure", async () => {
    const { runner } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc x\n" },
      "git push -u origin": { throw: true },
    });
    await expect(
      createPullRequest({ cwd: "/wt", branch: "ralph/eng-7", issue }, runner),
    ).rejects.toThrow("cmd failed");
  });
});
