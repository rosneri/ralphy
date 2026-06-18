import { describe, expect, test } from "bun:test";
import { createPullRequest, type CmdRunner } from "../pr";
import type { TrackedIssue } from "@ralphy/tracker";

// Exercises createPullRequest's meta-only classification: distinguishing a
// genuine no-op (branch history only ever touched meta files) from a lost
// implementation (history had real code) from a substantive diff.

const META = ["openspec/**", "**/tasks.md"];

const issue: TrackedIssue = {
  id: "i1",
  identifier: "LIT-300",
  title: "Eliminate disables",
  url: "https://linear.app/x/issue/LIT-300",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

/** Build a CmdRunner whose responses are keyed on the joined command. Any
 *  command not in the map returns empty stdout. */
function mockRunner(responses: Record<string, string>): {
  runner: CmdRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const runner: CmdRunner = {
    run: async (cmd) => {
      const key = cmd.join(" ");
      calls.push(key);
      return { stdout: responses[key] ?? "", stderr: "" };
    },
  };
  return { runner, calls };
}

const HAS_COMMITS = "git log --oneline main..HEAD --no-merges";
const NET_DIFF = "git diff --name-only origin/main...HEAD";
const MERGED = "gh pr list --head b --state merged --json number --jq .[0].number // empty";
const CHERRY = "git cherry main HEAD";
const HISTORY = "git log --name-only --pretty=format: main..HEAD";

describe("createPullRequest — no-op vs lost classification", () => {
  test("blocked 'no-op' when branch history touched only meta files", async () => {
    const { runner, calls } = mockRunner({
      [HAS_COMMITS]: "abc123 docs(lit-300)",
      [NET_DIFF]: "openspec/changes/lit-300/tasks.md\nopenspec/changes/lit-300/proposal.md",
      [MERGED]: "",
      [CHERRY]: "+ abc123",
      [HISTORY]: "openspec/changes/lit-300/tasks.md\nopenspec/changes/lit-300/proposal.md",
    });
    const result = await createPullRequest(
      { cwd: "/x", branch: "b", issue, base: "main", metaOnlyFiles: META },
      runner,
    );
    expect(result?.blocked).toBe("no-op");
    // Must NOT push or open a PR.
    expect(calls.some((c) => c.startsWith("git push"))).toBe(false);
    expect(calls.some((c) => c.startsWith("gh pr create"))).toBe(false);
  });

  test("blocked 'only-meta' when history touched real code (lost implementation)", async () => {
    const { runner } = mockRunner({
      [HAS_COMMITS]: "abc123 feat\ndef456 docs",
      [NET_DIFF]: "openspec/changes/lit-300/tasks.md",
      [MERGED]: "",
      [CHERRY]: "+ abc123",
      // A real source file was created earlier in the branch and later lost.
      [HISTORY]: "libs/x/src/foo.ts\nopenspec/changes/lit-300/tasks.md",
    });
    const result = await createPullRequest(
      { cwd: "/x", branch: "b", issue, base: "main", metaOnlyFiles: META },
      runner,
    );
    expect(result?.blocked).toBe("only-meta");
  });

  test("spec-authoring change: own spec delta is substantive, so a PR is opened (not no-op)", async () => {
    // A docs/spec ticket whose entire deliverable lives under its own change's
    // `specs/` dir matches the `openspec/**` meta glob, but it is the real
    // deliverable — it must be PR'd, not silently finalized as a no-op.
    const change = "lit-512-spec-doc-world-entity";
    const specFile = `openspec/changes/${change}/specs/world-entity/spec.md`;
    const calls: string[] = [];
    const runner: CmdRunner = {
      run: async (cmd) => {
        const key = cmd.join(" ");
        calls.push(key);
        if (key === HAS_COMMITS) return { stdout: "abc123 docs(lit-512)", stderr: "" };
        if (key === NET_DIFF) {
          return { stdout: `${specFile}\nopenspec/changes/${change}/tasks.md`, stderr: "" };
        }
        if (cmd[0] === "gh" && cmd[2] === "create") {
          return { stdout: "https://github.com/o/r/pull/9", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
    };
    const result = await createPullRequest(
      { cwd: "/x", branch: "b", issue, base: "main", metaOnlyFiles: META, changeName: change },
      runner,
    );
    expect(result?.blocked).toBeUndefined();
    expect(result?.url).toBe("https://github.com/o/r/pull/9");
    expect(calls.some((c) => c.startsWith("git push -u origin b"))).toBe(true);
  });

  test("carve-out is scoped to the change's OWN spec dir, not another change's", async () => {
    // A branch that only touches a *different* change's spec is still meta —
    // the carve-out must not leak across changes.
    const { runner } = mockRunner({
      [HAS_COMMITS]: "abc123 docs",
      [NET_DIFF]: "openspec/changes/lit-999-other/specs/x/spec.md",
      [MERGED]: "",
      [CHERRY]: "+ abc123",
      [HISTORY]: "openspec/changes/lit-999-other/specs/x/spec.md",
    });
    const result = await createPullRequest(
      {
        cwd: "/x",
        branch: "b",
        issue,
        base: "main",
        metaOnlyFiles: META,
        changeName: "lit-512-spec-doc-world-entity",
      },
      runner,
    );
    expect(result?.blocked).toBe("no-op");
  });

  test("returns null (nothing to PR) when a prior PR for the branch is merged", async () => {
    const { runner } = mockRunner({
      [HAS_COMMITS]: "abc123 docs",
      [NET_DIFF]: "openspec/changes/lit-300/tasks.md",
      [MERGED]: "473",
    });
    const result = await createPullRequest(
      { cwd: "/x", branch: "b", issue, base: "main", metaOnlyFiles: META },
      runner,
    );
    expect(result).toBeNull();
  });

  test("opens a PR normally when the diff contains substantive code", async () => {
    const calls: string[] = [];
    // `gh pr create` takes a dynamic body arg, so match by prefix here.
    const runner: CmdRunner = {
      run: async (cmd) => {
        const key = cmd.join(" ");
        calls.push(key);
        if (key === HAS_COMMITS) return { stdout: "abc123 feat", stderr: "" };
        if (key === NET_DIFF) {
          return { stdout: "libs/x/src/foo.ts\nopenspec/changes/lit-300/tasks.md", stderr: "" };
        }
        if (cmd[0] === "gh" && cmd[2] === "create") {
          return { stdout: "https://github.com/o/r/pull/1", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
    };

    const result = await createPullRequest(
      { cwd: "/x", branch: "b", issue, base: "main", metaOnlyFiles: META },
      runner,
    );
    expect(result?.blocked).toBeUndefined();
    expect(result?.url).toBe("https://github.com/o/r/pull/1");
    expect(result?.created).toBe(true);
    expect(calls.some((c) => c.startsWith("git push -u origin b"))).toBe(true);
  });
});
