import { describe, expect, test } from "bun:test";
import type { CmdRunner } from "../../../pr";
import type { LinearIssue } from "../../../linear";
import {
  createGithubTrackerProvider,
  githubIndicators,
  identifierForNumber,
  type GithubIssuesConfig,
} from "../github";

/** A CmdRunner that records every invocation and replies from a script map. */
function fakeRunner(replies: Record<string, string> = {}): {
  runner: CmdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      // Match on a stable signature: the gh subcommand chain.
      const key = cmd.slice(0, 3).join(" ");
      return { stdout: replies[key] ?? "", stderr: "" };
    },
  };
  return { runner, calls };
}

const ISSUES: GithubIssuesConfig = {
  repo: "acme/widgets",
  label: "ralph:todo",
  statusLabels: { inProgress: "ralph:in-progress", done: "ralph:done", error: "ralph:error" },
};

const diag = () => {};

function provider(replies: Record<string, string> = {}, issues = ISSUES) {
  const { runner, calls } = fakeRunner(replies);
  const p = createGithubTrackerProvider({ issues, cmdRunner: runner, projectRoot: "/repo", diag });
  return { p, calls };
}

const ghIssueJson = JSON.stringify([
  {
    number: 42,
    title: "Fix the thing",
    url: "https://github.com/acme/widgets/issues/42",
    body: "details",
    state: "OPEN",
    createdAt: "2026-01-01T00:00:00Z",
    labels: [{ name: "ralph:todo" }],
  },
]);

describe("createGithubTrackerProvider — fetch", () => {
  test("fetchByGet lists open issues by the filter label and maps to LinearIssue", async () => {
    const { p, calls } = provider({ "gh issue list": ghIssueJson });
    const issues = await p.fetchByGet({ filter: [{ type: "label", value: "ralph:todo" }] }, []);
    const listCall = calls.find((c) => c[1] === "issue" && c[2] === "list")!;
    expect(listCall).toContain("--repo");
    expect(listCall).toContain("acme/widgets");
    expect(listCall).toContain("--label");
    expect(listCall).toContain("ralph:todo");
    expect(listCall).toContain("--state");
    expect(listCall).toContain("open");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.identifier).toBe("issue-42");
    expect(issues[0]!.id).toBe("42");
    expect(issues[0]!.title).toBe("Fix the thing");
    expect(issues[0]!.url).toBe("https://github.com/acme/widgets/issues/42");
    expect(issues[0]!.labels).toEqual(["ralph:todo"]);
  });

  test("fetchByGet drops issues carrying an excluded label", async () => {
    const json = JSON.stringify([
      { number: 1, title: "a", url: "u1", state: "OPEN", labels: [{ name: "ralph:todo" }] },
      {
        number: 2,
        title: "b",
        url: "u2",
        state: "OPEN",
        labels: [{ name: "ralph:todo" }, { name: "ralph:done" }],
      },
    ]);
    const { p } = provider({ "gh issue list": json });
    const issues = await p.fetchByGet({ filter: [{ type: "label", value: "ralph:todo" }] }, [
      { type: "label", value: "ralph:done" },
    ]);
    expect(issues.map((i) => i.id)).toEqual(["1"]);
  });

  test("fetchByGet with an empty filter lists every open issue (no --label)", async () => {
    const { p, calls } = provider({ "gh issue list": "[]" }, { ...ISSUES, label: undefined });
    await p.fetchByGet({ filter: [] }, []);
    const listCall = calls.find((c) => c[2] === "list")!;
    expect(listCall).not.toContain("--label");
  });

  test("fetchByGet passes --assignee when configured", async () => {
    const { p, calls } = provider({ "gh issue list": "[]" }, { ...ISSUES, assignee: "@me" });
    await p.fetchByGet({ filter: [] }, []);
    const listCall = calls.find((c) => c[2] === "list")!;
    expect(listCall).toContain("--assignee");
    expect(listCall).toContain("@me");
  });

  test("fetchDoneCandidates lists issues by the in-progress label", async () => {
    const { p, calls } = provider({ "gh issue list": "[]" });
    await p.fetchDoneCandidates();
    const listCall = calls.find((c) => c[2] === "list")!;
    expect(listCall).toContain("--label");
    expect(listCall).toContain("ralph:in-progress");
  });
});

const issue: LinearIssue = {
  id: "42",
  identifier: "issue-42",
  title: "t",
  description: null,
  url: "u",
  state: { name: "Open", type: "started" },
  assignee: null,
  project: null,
  labels: ["ralph:todo"],
  priority: 0,
  createdAt: "",
  blockedByIds: [],
};

describe("createGithubTrackerProvider — lifecycle mapping", () => {
  test("setInProgress adds the in-progress label and removes the todo label", async () => {
    const { p, calls } = provider();
    await p.applyIndicator(issue, { type: "label", value: "ralph:in-progress" });
    const edits = calls.filter((c) => c[2] === "edit");
    expect(edits.some((c) => c.includes("--add-label") && c.includes("ralph:in-progress"))).toBe(
      true,
    );
    expect(edits.some((c) => c.includes("--remove-label") && c.includes("ralph:todo"))).toBe(true);
  });

  test("setDone adds the done label and closes the issue", async () => {
    const { p, calls } = provider();
    await p.applyIndicator(issue, { type: "label", value: "ralph:done" });
    expect(calls.some((c) => c[2] === "edit" && c.includes("ralph:done"))).toBe(true);
    expect(calls.some((c) => c[2] === "close" && c.includes("42"))).toBe(true);
  });

  test("setError adds the error label and does not close", async () => {
    const { p, calls } = provider();
    await p.applyIndicator(issue, { type: "label", value: "ralph:error" });
    expect(calls.some((c) => c[2] === "edit" && c.includes("ralph:error"))).toBe(true);
    expect(calls.some((c) => c[2] === "close")).toBe(false);
  });

  test("a comment marker runs gh issue comment", async () => {
    const { p, calls } = provider();
    await p.applyMarker(issue, { type: "comment", value: "progress!" });
    const comment = calls.find((c) => c[2] === "comment")!;
    expect(comment).toContain("--body");
    expect(comment).toContain("progress!");
  });

  test("removeIndicator removes the label", async () => {
    const { p, calls } = provider();
    await p.removeIndicator(issue, { type: "label", value: "ralph:in-progress" });
    const edit = calls.find((c) => c[2] === "edit")!;
    expect(edit).toContain("--remove-label");
    expect(edit).toContain("ralph:in-progress");
  });

  test("resolveLabelIdForTeam is a no-op returning null", async () => {
    const { p } = provider();
    expect(await p.resolveLabelIdForTeam("ENG", "x")).toBeNull();
  });
});

describe("createGithubTrackerProvider — repo resolution", () => {
  test("detects the repo from origin when none is configured", async () => {
    const { p, calls } = provider(
      { "gh repo view": "acme/detected\n", "gh issue list": "[]" },
      {
        ...ISSUES,
        repo: undefined,
      },
    );
    await p.fetchByGet({ filter: [] }, []);
    expect(calls.some((c) => c[1] === "repo" && c[2] === "view")).toBe(true);
    const listCall = calls.find((c) => c[2] === "list")!;
    expect(listCall[listCall.indexOf("--repo") + 1]).toBe("acme/detected");
  });

  test("surfaces a clear error when the repo cannot be resolved", async () => {
    const failing: CmdRunner = {
      run: async (cmd) => {
        if (cmd[1] === "repo") throw new Error("no remote");
        return { stdout: "[]", stderr: "" };
      },
    };
    const p = createGithubTrackerProvider({
      issues: { ...ISSUES, repo: undefined },
      cmdRunner: failing,
      projectRoot: "/repo",
      diag,
    });
    await expect(p.fetchByGet({ filter: [] }, [])).rejects.toThrow(/could not determine the repo/);
  });
});

describe("githubIndicators", () => {
  test("synthesizes label markers from the github.issues config", () => {
    const ind = githubIndicators(ISSUES);
    expect(ind.getTodo).toEqual({ filter: [{ type: "label", value: "ralph:todo" }] });
    expect(ind.getInProgress).toEqual({
      filter: [{ type: "label", value: "ralph:in-progress" }],
    });
    expect(ind.setInProgress).toEqual({ type: "label", value: "ralph:in-progress" });
    expect(ind.setDone).toEqual({ type: "label", value: "ralph:done" });
    expect(ind.setError).toEqual({ type: "label", value: "ralph:error" });
  });

  test("an absent todo label yields an empty getTodo filter (every open issue)", () => {
    const ind = githubIndicators({ ...ISSUES, label: undefined });
    expect(ind.getTodo).toEqual({ filter: [] });
  });

  test("falls back to ralph:* status labels when issues is undefined", () => {
    const ind = githubIndicators(undefined);
    expect(ind.setInProgress).toEqual({ type: "label", value: "ralph:in-progress" });
  });
});

describe("identifierForNumber", () => {
  test("formats a slug-safe identifier", () => {
    expect(identifierForNumber(42)).toBe("issue-42");
  });
});
