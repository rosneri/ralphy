import { describe, expect, test } from "bun:test";
import type { CmdRunner } from "../../../agent/pr";
import {
  addLabel,
  addReaction,
  branchNameForGitHubIssue,
  changeNameForGitHubIssue,
  closeIssue,
  createComment,
  createLabel,
  deriveTrackedState,
  listComments,
  listIssues,
  listLabels,
  mapGhIssue,
  numberFromGitHubBranch,
  numberFromGitHubChangeName,
  parseGitHubIdentifier,
  removeLabel,
  reopenIssue,
  statusLabelType,
  viewIssue,
} from "../github/github-client";
import { githubIdentifierStrategy, linearIdentifierStrategy } from "../github/identifier-strategy";
import type { TrackedIssue } from "@ralphy/tracker";
import { branchForChange } from "../../../agent/worktree";

function fakeRunner(stdoutByCall: string[] = []) {
  const calls: string[][] = [];
  let i = 0;
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      const stdout = stdoutByCall[i++] ?? "";
      return { stdout, stderr: "" };
    },
  };
  return { runner, calls };
}

const ISSUE_1 = {
  id: "I_kw1",
  number: 123,
  title: "Fix the thing",
  body: "details",
  state: "OPEN",
  stateReason: null,
  labels: [{ name: "bug" }],
  assignees: [{ id: "U_1", login: "octocat", name: "Octo Cat" }],
  author: { login: "someone" },
  createdAt: "2024-01-01T00:00:00Z",
  url: "https://github.com/o/r/issues/123",
};

describe("parseGitHubIdentifier", () => {
  test("bare #123", () => {
    expect(parseGitHubIdentifier("#123")).toEqual({ owner: null, repo: null, number: 123 });
  });
  test("bare number 123", () => {
    expect(parseGitHubIdentifier("123")).toEqual({ owner: null, repo: null, number: 123 });
  });
  test("owner/repo#123 parses into its parts", () => {
    expect(parseGitHubIdentifier("owner/repo#123")).toEqual({
      owner: "owner",
      repo: "repo",
      number: 123,
    });
  });
  test("throws on malformed input", () => {
    expect(() => parseGitHubIdentifier("not-an-issue")).toThrow();
    expect(() => parseGitHubIdentifier("")).toThrow();
  });
});

describe("identifier round-trip", () => {
  const issue = { number: 123, title: "Fix the thing" };

  test("change-name is gh-<number>-<slug> and round-trips to the number", () => {
    const name = changeNameForGitHubIssue(issue);
    expect(name).toBe("gh-123-fix-the-thing");
    expect(numberFromGitHubChangeName(name)).toBe(123);
  });

  test("branch is ralph/gh-<number>-<slug> and round-trips to the number", () => {
    const branch = branchNameForGitHubIssue(issue);
    expect(branch).toBe("ralph/gh-123-fix-the-thing");
    expect(numberFromGitHubBranch(branch)).toBe(123);
  });

  test("branchNameForGitHubIssue delegates to branchForChange(changeName)", () => {
    expect(branchNameForGitHubIssue(issue)).toBe(branchForChange(changeNameForGitHubIssue(issue)));
  });

  test("empty slug falls back to gh-<number>", () => {
    const name = changeNameForGitHubIssue({ number: 7, title: "!!!" });
    expect(name).toBe("gh-7");
    expect(numberFromGitHubChangeName(name)).toBe(7);
  });
});

describe("githubIdentifierStrategy", () => {
  test("scopeKey is owner/repo when present, else empty", () => {
    expect(
      githubIdentifierStrategy.scopeKey({ number: 1, title: "x", owner: "o", repo: "r" }),
    ).toBe("o/r");
    expect(githubIdentifierStrategy.scopeKey({ number: 1, title: "x" })).toBe("");
  });
  test("changeName / branchName mirror the standalone functions", () => {
    const issue = { number: 9, title: "Add dark mode" };
    expect(githubIdentifierStrategy.changeName(issue)).toBe(changeNameForGitHubIssue(issue));
    expect(githubIdentifierStrategy.branchName(issue)).toBe(branchNameForGitHubIssue(issue));
  });
});

describe("linearIdentifierStrategy", () => {
  const issue = { identifier: "RLF-232", title: "Add dark mode" } as TrackedIssue;
  test("scopeKey is the team key (identifier prefix)", () => {
    expect(linearIdentifierStrategy.scopeKey(issue)).toBe("RLF");
  });
  test("changeName lowercases the identifier and slugs the title", () => {
    expect(linearIdentifierStrategy.changeName(issue)).toBe("rlf-232-add-dark-mode");
  });
  test("branchName wraps changeName via branchForChange", () => {
    expect(linearIdentifierStrategy.branchName(issue)).toBe(
      branchForChange(linearIdentifierStrategy.changeName(issue)),
    );
  });
});

describe("state derivation", () => {
  test("OPEN with no status label → unstarted", () => {
    expect(deriveTrackedState("OPEN", null, ["bug"])).toEqual({ name: "OPEN", type: "unstarted" });
  });
  test("OPEN with status:in progress label → started", () => {
    expect(deriveTrackedState("OPEN", null, ["status:in progress"])).toEqual({
      name: "status:in progress",
      type: "started",
    });
  });
  test("CLOSED + COMPLETED → completed", () => {
    expect(deriveTrackedState("CLOSED", "COMPLETED", [])).toEqual({
      name: "CLOSED",
      type: "completed",
    });
  });
  test("CLOSED + null reason → completed", () => {
    expect(deriveTrackedState("CLOSED", null, [])).toEqual({ name: "CLOSED", type: "completed" });
  });
  test("CLOSED + NOT_PLANNED → canceled", () => {
    expect(deriveTrackedState("CLOSED", "NOT_PLANNED", [])).toEqual({
      name: "CLOSED",
      type: "canceled",
    });
  });
  test("statusLabelType matches started variants and ignores others", () => {
    expect(statusLabelType(["status:started"])?.type).toBe("started");
    expect(statusLabelType(["in-progress"])?.type).toBe("started");
    expect(statusLabelType(["bug", "p1"])).toBeNull();
  });
});

describe("mapGhIssue", () => {
  test("maps gh JSON to a TrackedIssue (first assignee, null-safe fields)", () => {
    const issue = mapGhIssue(ISSUE_1);
    expect(issue.number).toBe(123);
    expect(issue.identifier).toBe("#123");
    expect(issue.title).toBe("Fix the thing");
    expect(issue.description).toBe("details");
    expect(issue.url).toBe("https://github.com/o/r/issues/123");
    expect(issue.labels).toEqual(["bug"]);
    expect(issue.assignee).toEqual({ id: "U_1", email: null, name: "Octo Cat" });
    expect(issue.state).toEqual({ name: "OPEN", type: "unstarted" });
  });
  test("missing assignees → null; missing body → null", () => {
    const issue = mapGhIssue({ number: 5, state: "OPEN", assignees: [], labels: [] });
    expect(issue.assignee).toBeNull();
    expect(issue.description).toBeNull();
  });
  test("maps embedded comments when present", () => {
    const issue = mapGhIssue({
      ...ISSUE_1,
      comments: [
        { id: "C1", body: "hi", createdAt: "2024-02-02T00:00:00Z", author: { login: "x" } },
      ],
    });
    expect(issue.comments).toEqual([
      { id: "C1", body: "hi", createdAt: "2024-02-02T00:00:00Z", user: { name: "x", email: null } },
    ]);
  });
});

describe("function bag — built argv + mapping (no live network)", () => {
  test("listIssues builds gh issue list with filters and maps JSON; never searches", async () => {
    const { runner, calls } = fakeRunner([JSON.stringify([ISSUE_1, { ...ISSUE_1, number: 124 }])]);
    const issues = await listIssues(runner, "/repo", {
      state: "open",
      labels: ["bug"],
      assignee: "me",
    });
    const argv = calls[0]!;
    expect(argv.slice(0, 4)).toEqual(["gh", "issue", "list", "--state"]);
    expect(argv).toContain("--label");
    expect(argv).toContain("bug");
    expect(argv).toContain("--assignee");
    expect(argv).toContain("me");
    expect(argv).toContain("--json");
    expect(argv).not.toContain("search");
    expect(issues.map((i) => i.number)).toEqual([123, 124]);
    expect(issues[0]!.url).toBe(ISSUE_1.url);
  });

  test("viewIssue resolves owner/repo#123 to --repo and a numeric arg", async () => {
    const { runner, calls } = fakeRunner([JSON.stringify(ISSUE_1)]);
    const issue = await viewIssue(runner, "/repo", "owner/repo#123");
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "view",
      "123",
      "--repo",
      "owner/repo",
      "--json",
      "id,number,title,body,state,stateReason,labels,assignees,author,createdAt,url,comments",
    ]);
    expect(issue.number).toBe(123);
  });

  test("listComments reads gh issue view --json comments and maps them", async () => {
    const { runner, calls } = fakeRunner([
      JSON.stringify({
        comments: [{ id: "C1", body: "hi", createdAt: "t", author: { login: "x" } }],
      }),
    ]);
    const comments = await listComments(runner, "/repo", "#123");
    expect(calls[0]).toEqual(["gh", "issue", "view", "#123", "--json", "comments"]);
    expect(comments).toEqual([
      { id: "C1", body: "hi", createdAt: "t", user: { name: "x", email: null } },
    ]);
  });

  test("createComment posts without reading the network", async () => {
    const { runner, calls } = fakeRunner([""]);
    await createComment(runner, "/repo", "#123", "hello");
    expect(calls[0]).toEqual(["gh", "issue", "comment", "#123", "--body", "hello"]);
  });

  test("addLabel / removeLabel build gh issue edit", async () => {
    const add = fakeRunner([""]);
    await addLabel(add.runner, "/repo", "#1", "bug");
    expect(add.calls[0]).toEqual(["gh", "issue", "edit", "#1", "--add-label", "bug"]);
    const rm = fakeRunner([""]);
    await removeLabel(rm.runner, "/repo", "#1", "bug");
    expect(rm.calls[0]).toEqual(["gh", "issue", "edit", "#1", "--remove-label", "bug"]);
  });

  test("createLabel passes color/description/force flags", async () => {
    const { runner, calls } = fakeRunner([""]);
    await createLabel(runner, "/repo", "status:in progress", {
      color: "ededed",
      description: "WIP",
      force: true,
    });
    expect(calls[0]).toEqual([
      "gh",
      "label",
      "create",
      "status:in progress",
      "--color",
      "ededed",
      "--description",
      "WIP",
      "--force",
    ]);
  });

  test("listLabels maps name/id/description", async () => {
    const { runner, calls } = fakeRunner([
      JSON.stringify([{ name: "bug", id: "L1", description: "d" }]),
    ]);
    const labels = await listLabels(runner, "/repo");
    expect(calls[0]!.slice(0, 4)).toEqual(["gh", "label", "list", "--json"]);
    expect(labels).toEqual([{ name: "bug", id: "L1", description: "d" }]);
  });

  test("closeIssue passes --reason and reopenIssue reopens", async () => {
    const close = fakeRunner([""]);
    await closeIssue(close.runner, "/repo", "#1", { reason: "not planned" });
    expect(close.calls[0]).toEqual(["gh", "issue", "close", "#1", "--reason", "not planned"]);
    const reopen = fakeRunner([""]);
    await reopenIssue(reopen.runner, "/repo", "#1");
    expect(reopen.calls[0]).toEqual(["gh", "issue", "reopen", "#1"]);
  });

  test("addReaction with owner/repo posts directly via gh api", async () => {
    const { runner, calls } = fakeRunner([""]);
    await addReaction(runner, "/repo", "owner/repo#123", "+1");
    expect(calls[0]).toEqual([
      "gh",
      "api",
      "-X",
      "POST",
      "repos/owner/repo/issues/123/reactions",
      "-f",
      "content=+1",
    ]);
  });

  test("addReaction resolves nameWithOwner when ref lacks owner/repo", async () => {
    const { runner, calls } = fakeRunner([JSON.stringify({ nameWithOwner: "acme/widgets" }), ""]);
    await addReaction(runner, "/repo", "#123", "rocket");
    expect(calls[0]).toEqual(["gh", "repo", "view", "--json", "nameWithOwner"]);
    expect(calls[1]).toEqual([
      "gh",
      "api",
      "-X",
      "POST",
      "repos/acme/widgets/issues/123/reactions",
      "-f",
      "content=rocket",
    ]);
  });
});
