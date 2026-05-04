import { describe, expect, test } from "bun:test";
import { createPullRequest, type CmdRunner } from "../agent/pr";
import type { LinearIssue } from "../agent/linear";

const issue: LinearIssue = {
  id: "u1",
  identifier: "ENG-7",
  title: "Add feature",
  description: "Some details.",
  url: "https://linear.app/x/issue/ENG-7",
  state: { name: "Todo", type: "unstarted" },
  assignee: null,
  labels: [],
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
