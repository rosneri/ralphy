import { describe, expect, test } from "bun:test";
import { createOpenDraftPr } from "../pr-helpers";
import type { CmdRunner } from "../../pr";
import type { TrackedIssue } from "@ralphy/tracker";

function makeIssue(labels: string[] = []): TrackedIssue {
  return {
    id: "u-1",
    identifier: "ENG-9",
    title: "Add feature",
    description: "Why and what.",
    url: "https://linear.app/x/issue/ENG-9",
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels,
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

function makeRunner(responses: Record<string, { stdout?: string; throw?: boolean }>): {
  runner: CmdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push([...cmd]);
      const key = cmd.join(" ");
      for (const [prefix, r] of Object.entries(responses)) {
        if (key.startsWith(prefix)) {
          if (r.throw) throw new Error("cmd failed");
          return { stdout: r.stdout ?? "", stderr: "" };
        }
      }
      return { stdout: "", stderr: "" };
    },
  };
  return { runner, calls };
}

function baseDeps(runner: CmdRunner, branchByChange: Map<string, string>) {
  const prByChange = new Map<string, string>();
  const invalidated: string[] = [];
  const deps = {
    branchByChange,
    prByChange,
    cmdRunner: runner,
    prBaseBranch: "main",
    invalidatePrUrlForIssue: (id: string) => invalidated.push(id),
  };
  return { deps, prByChange, invalidated };
}

describe("createOpenDraftPr", () => {
  test("returns null and runs no commands when no branch is tracked", async () => {
    const { runner, calls } = makeRunner({});
    const { deps, prByChange } = baseDeps(runner, new Map());
    const open = createOpenDraftPr(deps);

    const url = await open(makeIssue(), "my-change", "/wt");

    expect(url).toBeNull();
    expect(calls.length).toBe(0);
    expect(prByChange.size).toBe(0);
  });

  test("opens a DRAFT PR for a design-only branch (meta-only guard bypassed) and registers it", async () => {
    const prUrl = "https://github.com/owner/repo/pull/500";
    const { runner, calls } = makeRunner({
      // The branch has the committed design — something to PR.
      "git log --oneline main..HEAD": { stdout: "abc design + tasks" },
      "git push -u origin": { stdout: "" },
      // No existing open PR for this branch.
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: prUrl },
    });
    const branchByChange = new Map([["my-change", "ralph/my-change"]]);
    const { deps, prByChange, invalidated } = baseDeps(runner, branchByChange);
    const open = createOpenDraftPr(deps);

    const url = await open(makeIssue(), "my-change", "/wt");

    expect(url).toBe(prUrl);
    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall).toBeDefined();
    expect(createCall).toContain("--draft");
    expect(createCall).toContain("--base");
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("main");
    // The branch was pushed.
    expect(calls.some((c) => c.join(" ").startsWith("git push -u origin"))).toBe(true);
    // The meta-only guard must NOT have run (no `git diff --name-only`) — a
    // design-only PR is intentionally allowed.
    expect(calls.some((c) => c.join(" ").startsWith("git diff --name-only"))).toBe(false);
    // The opened PR is registered + the discovery cache is invalidated.
    expect(prByChange.get("my-change")).toBe(prUrl);
    expect(invalidated).toContain("u-1");
  });

  test("honors a ralph:branch:<name> label as the PR base", async () => {
    const { runner, calls } = makeRunner({
      "git log --oneline release/2026..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      "gh pr list": { stdout: "" },
      "gh pr create": { stdout: "https://github.com/owner/repo/pull/501" },
    });
    const branchByChange = new Map([["my-change", "ralph/my-change"]]);
    const { deps } = baseDeps(runner, branchByChange);
    const open = createOpenDraftPr(deps);

    await open(makeIssue(["ralph:branch:release/2026"]), "my-change", "/wt");

    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    expect(createCall[createCall.indexOf("--base") + 1]).toBe("release/2026");
  });

  test("surfaces an existing PR (idempotent) and still registers it", async () => {
    const existing = "https://github.com/owner/repo/pull/42";
    const { runner, calls } = makeRunner({
      "git log --oneline main..HEAD": { stdout: "abc work" },
      "git push -u origin": { stdout: "" },
      // An open PR already exists for this branch.
      "gh pr list": { stdout: existing },
    });
    const branchByChange = new Map([["my-change", "ralph/my-change"]]);
    const { deps, prByChange } = baseDeps(runner, branchByChange);
    const open = createOpenDraftPr(deps);

    const url = await open(makeIssue(), "my-change", "/wt");

    expect(url).toBe(existing);
    // No second create call — the existing PR is surfaced.
    expect(calls.some((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")).toBe(false);
    expect(prByChange.get("my-change")).toBe(existing);
  });
});
