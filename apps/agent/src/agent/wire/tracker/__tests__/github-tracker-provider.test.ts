import { describe, expect, test } from "bun:test";
import type { CmdRunner } from "../../../pr";
import {
  createGithubTrackerProvider,
  flattenLabel,
  githubIndicatorAction,
  mapGithubIssue,
  staleStatusLabels,
  type GithubMarkerVocab,
} from "../github-tracker-provider";

const VOCAB: GithubMarkerVocab = {
  selectionLabel: "ralphy:todo",
  inProgressLabel: "status:in-progress",
  reviewLabel: "status:in-review",
  lifecycleLabels: ["status:in-progress", "status:in-review", "status:pr-ready", "status:error"],
};

/** Records every argv and replays canned stdout in FIFO order. */
function scriptedRunner(stdouts: string[] = []): { runner: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      return { stdout: stdouts[i++] ?? "[]", stderr: "" };
    },
  };
  return { runner, calls };
}

function makeProvider(stdouts: string[] = []) {
  const { runner, calls } = scriptedRunner(stdouts);
  const client = createGithubTrackerProvider({
    runner,
    cwd: "/tmp/repo",
    repo: "acme/widgets",
    vocab: VOCAB,
  });
  return { client, calls };
}

const issueJson = (
  over: Partial<{
    number: number;
    state: string;
    labels: { name: string }[];
  }> = {},
) =>
  JSON.stringify([
    {
      number: over.number ?? 7,
      title: "an issue",
      body: "body text",
      url: "https://github.com/acme/widgets/issues/7",
      state: over.state ?? "OPEN",
      labels: over.labels ?? [{ name: "ralphy:todo" }],
      assignees: [{ login: "octocat", name: "Octo Cat", id: "u1" }],
      createdAt: "2025-01-01T00:00:00Z",
    },
  ]);

describe("mapGithubIssue", () => {
  test("maps number, labels, assignee and open state", () => {
    const issue = mapGithubIssue({
      number: 42,
      title: "hi",
      body: "desc",
      url: "u",
      state: "OPEN",
      labels: [{ name: "a" }, { name: "b" }],
      assignees: [{ login: "octo", name: "Octo", id: "x" }],
    });
    expect(issue.id).toBe("42");
    expect(issue.identifier).toBe("#42");
    expect(issue.description).toBe("desc");
    expect(issue.labels).toEqual(["a", "b"]);
    expect(issue.assignee).toEqual({ id: "x", email: null, name: "Octo" });
    expect(issue.state).toEqual({ name: "Open", type: "started" });
  });

  test("closed issue maps to type completed", () => {
    const issue = mapGithubIssue({ number: 1, state: "CLOSED" });
    expect(issue.state).toEqual({ name: "Closed", type: "completed" });
  });

  test("missing assignees yields null", () => {
    expect(mapGithubIssue({ number: 1 }).assignee).toBeNull();
  });
});

describe("flattenLabel", () => {
  test("grouped label flattens to group:value", () => {
    expect(flattenLabel({ type: "label", value: "error", group: "Ralphy" })).toBe("Ralphy:error");
  });

  test("ungrouped label keeps its bare value", () => {
    expect(flattenLabel({ type: "label", value: "status:in-progress" })).toBe("status:in-progress");
  });

  test("non-label marker returns its value unchanged", () => {
    expect(flattenLabel({ type: "status", value: "Done" })).toBe("Done");
  });
});

describe("githubIndicatorAction", () => {
  test("done label classifies as close", () => {
    expect(githubIndicatorAction({ type: "label", value: "status:done" })).toEqual({
      kind: "close",
    });
  });

  test("done status classifies as close", () => {
    expect(githubIndicatorAction({ type: "status", value: "Done" })).toEqual({ kind: "close" });
  });

  test("non-done label classifies as add-label", () => {
    expect(githubIndicatorAction({ type: "label", value: "status:in-progress" })).toEqual({
      kind: "add-label",
      labels: ["status:in-progress"],
    });
  });

  test("remove op never resolves to close", () => {
    expect(githubIndicatorAction({ type: "label", value: "status:done" }, "remove")).toEqual({
      kind: "remove-label",
      labels: ["status:done"],
    });
  });

  test("grouped label flattens to group:value in add-label", () => {
    expect(githubIndicatorAction({ type: "label", value: "error", group: "Ralphy" })).toEqual({
      kind: "add-label",
      labels: ["Ralphy:error"],
    });
  });

  test("grouped done label still classifies as close", () => {
    expect(githubIndicatorAction({ type: "label", value: "done", group: "status" })).toEqual({
      kind: "close",
    });
  });
});

describe("staleStatusLabels", () => {
  test("returns empty when no prior status label is present", () => {
    expect(staleStatusLabels(["ralphy:todo"], ["status:in-progress"], "status:")).toEqual([]);
  });

  test("returns the single prior status label being superseded", () => {
    expect(
      staleStatusLabels(["ralphy:todo", "status:in-progress"], ["status:in-review"], "status:"),
    ).toEqual(["status:in-progress"]);
  });

  test("ignores non-status labels", () => {
    expect(
      staleStatusLabels(["ralphy:todo", "ralphy:branch:main"], ["status:in-progress"], "status:"),
    ).toEqual([]);
  });

  test("excludes the label being re-applied (idempotent re-apply)", () => {
    expect(staleStatusLabels(["status:in-progress"], ["status:in-progress"], "status:")).toEqual(
      [],
    );
  });

  test("returns multiple stale status markers, keeping any being re-applied", () => {
    expect(
      staleStatusLabels(
        ["status:in-progress", "status:error", "ralphy:todo"],
        ["status:in-review", "status:error"],
        "status:",
      ),
    ).toEqual(["status:in-progress"]);
  });
});

describe("fetch buckets build correct gh argv", () => {
  test("fetchTodo lists open + selection label and drops lifecycle-labelled issues", async () => {
    const { client, calls } = makeProvider([
      JSON.stringify([
        { number: 1, state: "OPEN", labels: [{ name: "ralphy:todo" }] },
        {
          number: 2,
          state: "OPEN",
          labels: [{ name: "ralphy:todo" }, { name: "status:in-progress" }],
        },
      ]),
    ]);
    const todo = await client.fetchTodo();
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      "ralphy:todo",
      "--json",
      "number,title,body,url,state,labels,assignees,createdAt",
      "--repo",
      "acme/widgets",
    ]);
    expect(todo.map((i) => i.identifier)).toEqual(["#1"]);
  });

  test("fetchInProgress filters by in-progress label", async () => {
    const { client, calls } = makeProvider([
      issueJson({ labels: [{ name: "status:in-progress" }] }),
    ]);
    await client.fetchInProgress();
    expect(calls[0]).toContain("--label");
    expect(calls[0]).toContain("status:in-progress");
    expect(calls[0]).toContain("--state");
    expect(calls[0]).toContain("open");
  });

  test("fetchReview filters by review label", async () => {
    const { client, calls } = makeProvider([issueJson({ labels: [{ name: "status:in-review" }] })]);
    await client.fetchReview();
    expect(calls[0]).toContain("status:in-review");
  });

  test("fetchDoneCandidates lists closed issues", async () => {
    const { client, calls } = makeProvider([issueJson({ state: "CLOSED" })]);
    const done = await client.fetchDoneCandidates();
    expect(calls[0]).toContain("--state");
    expect(calls[0]).toContain("closed");
    expect(done[0]?.state).toEqual({ name: "Closed", type: "completed" });
  });
});

describe("indicator side effects build correct gh argv", () => {
  const issue = mapGithubIssue({ number: 9, state: "OPEN" });

  test("applyIndicator(in-progress) ensures the label then issues issue edit --add-label", async () => {
    // Empty label list (default "[]") → the label is missing and gets created
    // before the edit.
    const { client, calls } = makeProvider();
    await client.applyIndicator(issue, { type: "label", value: "status:in-progress" });
    expect(calls).toEqual([
      ["gh", "label", "list", "--json", "name", "--repo", "acme/widgets"],
      ["gh", "label", "create", "status:in-progress", "--repo", "acme/widgets"],
      ["gh", "issue", "edit", "9", "--add-label", "status:in-progress", "--repo", "acme/widgets"],
    ]);
  });

  test("applyIndicator creates a missing label before the edit", async () => {
    const { client, calls } = makeProvider([JSON.stringify([{ name: "ralphy:todo" }])]);
    await client.applyIndicator(issue, { type: "label", value: "status:in-progress" });
    expect(calls.map((c) => c.slice(0, 3))).toEqual([
      ["gh", "label", "list"],
      ["gh", "label", "create"],
      ["gh", "issue", "edit"],
    ]);
    expect(calls[1]).toContain("status:in-progress");
  });

  test("applyIndicator does not re-create an existing label", async () => {
    const { client, calls } = makeProvider([JSON.stringify([{ name: "status:in-progress" }])]);
    await client.applyIndicator(issue, { type: "label", value: "status:in-progress" });
    expect(calls).toEqual([
      ["gh", "label", "list", "--json", "name", "--repo", "acme/widgets"],
      ["gh", "issue", "edit", "9", "--add-label", "status:in-progress", "--repo", "acme/widgets"],
    ]);
  });

  test("existing label match is case-insensitive (no re-create)", async () => {
    const { client, calls } = makeProvider([JSON.stringify([{ name: "Status:In-Progress" }])]);
    await client.applyIndicator(issue, { type: "label", value: "status:in-progress" });
    expect(calls.some((c) => c[1] === "label" && c[2] === "create")).toBe(false);
  });

  test("repeat applyIndicator does not re-list or re-create (cache hit)", async () => {
    const { client, calls } = makeProvider();
    await client.applyIndicator(issue, { type: "label", value: "status:in-progress" });
    const afterFirst = calls.length;
    await client.applyIndicator(issue, { type: "label", value: "status:in-progress" });
    // Second apply: only the edit, no further list/create.
    expect(calls.slice(afterFirst)).toEqual([
      ["gh", "issue", "edit", "9", "--add-label", "status:in-progress", "--repo", "acme/widgets"],
    ]);
  });

  test("grouped label is created and added as group:value", async () => {
    const { client, calls } = makeProvider();
    await client.applyIndicator(issue, { type: "label", value: "error", group: "Ralphy" });
    expect(calls).toEqual([
      ["gh", "label", "list", "--json", "name", "--repo", "acme/widgets"],
      ["gh", "label", "create", "Ralphy:error", "--repo", "acme/widgets"],
      ["gh", "issue", "edit", "9", "--add-label", "Ralphy:error", "--repo", "acme/widgets"],
    ]);
  });

  test("applyIndicator on a fresh transition emits no --remove-label", async () => {
    const { client, calls } = makeProvider();
    const fresh = mapGithubIssue({ number: 9, state: "OPEN", labels: [{ name: "ralphy:todo" }] });
    await client.applyIndicator(fresh, { type: "label", value: "status:in-progress" });
    const editCall = calls.find((c) => c[1] === "issue" && c[2] === "edit");
    expect(editCall).toEqual([
      "gh",
      "issue",
      "edit",
      "9",
      "--add-label",
      "status:in-progress",
      "--repo",
      "acme/widgets",
    ]);
    expect(editCall).not.toContain("--remove-label");
  });

  test("applyIndicator on in-progress → review strips the prior status label", async () => {
    const { client, calls } = makeProvider();
    const inProgress = mapGithubIssue({
      number: 9,
      state: "OPEN",
      labels: [{ name: "ralphy:todo" }, { name: "status:in-progress" }],
    });
    await client.applyIndicator(inProgress, { type: "label", value: "status:in-review" });
    const editCall = calls.find((c) => c[1] === "issue" && c[2] === "edit");
    expect(editCall).toEqual([
      "gh",
      "issue",
      "edit",
      "9",
      "--add-label",
      "status:in-review",
      "--remove-label",
      "status:in-progress",
      "--repo",
      "acme/widgets",
    ]);
  });

  test("applyIndicator never strips non-status labels during a transition", async () => {
    const { client, calls } = makeProvider();
    const withMarkers = mapGithubIssue({
      number: 9,
      state: "OPEN",
      labels: [{ name: "ralphy:todo" }, { name: "status:in-progress" }],
    });
    await client.applyIndicator(withMarkers, { type: "label", value: "status:in-review" });
    const editCall = calls.find((c) => c[1] === "issue" && c[2] === "edit");
    const removeIdx = editCall?.indexOf("--remove-label") ?? -1;
    expect(editCall?.[removeIdx + 1]).toBe("status:in-progress");
    expect(editCall).not.toContain("ralphy:todo");
  });

  test("applyIndicator(done) issues issue close", async () => {
    const { client, calls } = makeProvider();
    await client.applyIndicator(issue, { type: "label", value: "status:done" });
    expect(calls[0]).toEqual(["gh", "issue", "close", "9", "--repo", "acme/widgets"]);
  });

  test("removeIndicator issues issue edit --remove-label", async () => {
    const { client, calls } = makeProvider();
    await client.removeIndicator(issue, { type: "label", value: "status:in-review" });
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "edit",
      "9",
      "--remove-label",
      "status:in-review",
      "--repo",
      "acme/widgets",
    ]);
  });

  test("postComment issues issue comment --body", async () => {
    const { client, calls } = makeProvider();
    await client.postComment(issue, "hello world");
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "comment",
      "9",
      "--body",
      "hello world",
      "--repo",
      "acme/widgets",
    ]);
  });
});

describe("fetchComments and fetchMentions", () => {
  test("fetchComments parses gh issue view comments", async () => {
    const { client, calls } = makeProvider([
      JSON.stringify({ comments: [{ body: "first" }, { body: "second" }] }),
    ]);
    const bodies = (await client.fetchComments("9")).map((c) => c.body);
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "view",
      "9",
      "--json",
      "comments",
      "--repo",
      "acme/widgets",
    ]);
    expect(bodies).toEqual(["first", "second"]);
  });

  test("fetchMentions is a deferred stub returning []", async () => {
    const { client, calls } = makeProvider();
    expect(await client.fetchMentions()).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
