import { describe, expect, test } from "bun:test";
import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import type { MentionTrigger, TrackedIssue } from "@ralphy/tracker";
import {
  createGithubTrackerProvider,
  flattenLabel,
  githubIndicatorAction,
  mapGithubIssue,
  staleStatusLabels,
} from "../github-tracker-provider";

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

// --- The delegating coordinator seam -------------------------------------

const ISSUE: TrackedIssue = {
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

const INDICATORS: Indicators = {
  getTodo: { filter: [{ type: "label", value: "ralph:todo" }] },
  getInProgress: { filter: [{ type: "label", value: "ralph:in-progress" }] },
  setInProgress: { type: "label", value: "ralph:in-progress" },
  setDone: { type: "label", value: "ralph:done" },
  setError: { type: "label", value: "ralph:error" },
};

const EXCLUDE_FROM_TODO: Marker[] = [
  { type: "label", value: "ralph:done" },
  { type: "label", value: "ralph:error" },
  { type: "label", value: "ralph:in-progress" },
];

/** A scripted GitHub transport recording every delegated call. `fetchByGet`
 *  records its (include, exclude) args; the others record their inputs. */
function fakeTransport(comments: { body: string }[] = []) {
  const calls: {
    fetchByGet: { inc: unknown; excl: Marker[] }[];
    fetchDoneCandidates: number;
    applyIndicator: { issue: TrackedIssue; ind: SetIndicator }[];
    removeIndicator: { issue: TrackedIssue; ind: SetIndicator }[];
    applyMarker: { issue: TrackedIssue; m: Marker }[];
    fetchComments: string[];
  } = {
    fetchByGet: [],
    fetchDoneCandidates: 0,
    applyIndicator: [],
    removeIndicator: [],
    applyMarker: [],
    fetchComments: [],
  };
  const transport = {
    fetchByGet: async (inc: unknown, excl: Marker[]) => {
      calls.fetchByGet.push({ inc, excl });
      return [ISSUE];
    },
    fetchDoneCandidates: async () => {
      calls.fetchDoneCandidates += 1;
      return [ISSUE];
    },
    applyIndicator: async (issue: TrackedIssue, ind: SetIndicator) => {
      calls.applyIndicator.push({ issue, ind });
    },
    removeIndicator: async (issue: TrackedIssue, ind: SetIndicator) => {
      calls.removeIndicator.push({ issue, ind });
    },
    applyMarker: async (issue: TrackedIssue, m: Marker) => {
      calls.applyMarker.push({ issue, m });
    },
    fetchComments: async (issueId: string) => {
      calls.fetchComments.push(issueId);
      return comments;
    },
  };
  return { transport, calls };
}

const NO_MENTIONS = async (): Promise<{ issue: TrackedIssue; trigger: MentionTrigger }[]> => [];

function makeSeam(comments: { body: string }[] = []) {
  const { transport, calls } = fakeTransport(comments);
  const seam = createGithubTrackerProvider({
    provider: transport,
    indicators: INDICATORS,
    excludeFromTodo: EXCLUDE_FROM_TODO,
    fetchMentions: NO_MENTIONS,
  });
  return { seam, calls };
}

describe("createGithubTrackerProvider — delegating seam", () => {
  test("fetchTodo delegates to fetchByGet with getTodo and the todo-exclusion set", async () => {
    const { seam, calls } = makeSeam();
    const issues = await seam.fetchTodo();
    expect(issues).toEqual([ISSUE]);
    expect(calls.fetchByGet).toHaveLength(1);
    expect(calls.fetchByGet[0]!.inc).toEqual(INDICATORS.getTodo);
    expect(calls.fetchByGet[0]!.excl).toEqual(EXCLUDE_FROM_TODO);
  });

  test("fetchInProgress delegates with getInProgress, excluding the error marker", async () => {
    const { seam, calls } = makeSeam();
    await seam.fetchInProgress();
    expect(calls.fetchByGet[0]!.inc).toEqual(INDICATORS.getInProgress);
    expect(calls.fetchByGet[0]!.excl).toEqual([{ type: "label", value: "ralph:error" }]);
  });

  test("fetchReview returns [] without touching the transport", async () => {
    const { seam, calls } = makeSeam();
    expect(await seam.fetchReview()).toEqual([]);
    expect(calls.fetchByGet).toHaveLength(0);
  });

  test("fetchDoneCandidates delegates to the transport", async () => {
    const { seam, calls } = makeSeam();
    expect(await seam.fetchDoneCandidates()).toEqual([ISSUE]);
    expect(calls.fetchDoneCandidates).toBe(1);
  });

  test("fetchComments returns the transport's real comments", async () => {
    const { seam, calls } = makeSeam([{ body: "first" }, { body: "second" }]);
    const bodies = (await seam.fetchComments("42")).map((c) => c.body);
    expect(bodies).toEqual(["first", "second"]);
    expect(calls.fetchComments).toEqual(["42"]);
  });

  test("fetchComments on an issue with no comments returns []", async () => {
    const { seam } = makeSeam([]);
    expect(await seam.fetchComments("42")).toEqual([]);
  });

  test("applyIndicator and removeIndicator delegate straight to the transport", async () => {
    const { seam, calls } = makeSeam();
    const ind: SetIndicator = { type: "label", value: "ralph:in-progress" };
    await seam.applyIndicator(ISSUE, ind);
    await seam.removeIndicator(ISSUE, ind);
    expect(calls.applyIndicator).toEqual([{ issue: ISSUE, ind }]);
    expect(calls.removeIndicator).toEqual([{ issue: ISSUE, ind }]);
  });

  test("postComment routes through the transport's comment marker", async () => {
    const { seam, calls } = makeSeam();
    await seam.postComment(ISSUE, "progress!");
    expect(calls.applyMarker).toEqual([
      { issue: ISSUE, m: { type: "comment", value: "progress!" } },
    ]);
  });

  test("fetchMentions is the injected scanner", async () => {
    const trigger: MentionTrigger = {
      source: "github",
      body: "@ralphy hi",
      createdAt: "2026-01-01T00:00:00Z",
      author: "octo",
      url: "u",
    };
    const { transport } = fakeTransport();
    const seam = createGithubTrackerProvider({
      provider: transport,
      indicators: INDICATORS,
      excludeFromTodo: EXCLUDE_FROM_TODO,
      fetchMentions: async () => [{ issue: ISSUE, trigger }],
    });
    expect(await seam.fetchMentions()).toEqual([{ issue: ISSUE, trigger }]);
  });
});
