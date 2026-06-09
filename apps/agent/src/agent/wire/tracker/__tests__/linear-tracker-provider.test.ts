import { describe, expect, test, mock } from "bun:test";
import type { GetIndicator, Indicators, Marker, SetIndicator } from "@ralphy/types";
import type { TrackedIssue } from "@ralphy/tracker";

// Stub the Linear transport so `postComment`/`fetchComments` delegation can be
// observed without a network round-trip, and `fetchDoneCandidatesWith` so the
// done-candidate path is checked for its `--ticket` normalization.
const addIssueCommentCalls: { issueId: string; body: string }[] = [];
const fetchIssueCommentsCalls: string[] = [];
const fetchDoneCandidatesCalls: unknown[][] = [];

mock.module("../../../linear", () => ({
  addIssueComment: async (_apiKey: string, issueId: string, body: string) => {
    addIssueCommentCalls.push({ issueId, body });
  },
  fetchIssueComments: async (_apiKey: string, issueId: string) => {
    fetchIssueCommentsCalls.push(issueId);
    return [
      { id: "c1", body: "hello", createdAt: "2026-01-01T00:00:00.000Z", user: null },
      { id: "c2", body: "world", createdAt: "2026-01-01T00:00:00.000Z", user: null },
    ];
  },
}));

mock.module("../../linear-resolvers", () => ({
  fetchDoneCandidatesWith: async (...args: unknown[]) => {
    fetchDoneCandidatesCalls.push(args);
    return [];
  },
}));

const { createLinearTrackerProvider } = await import("../linear-tracker-provider");

function makeIssue(): TrackedIssue {
  return {
    id: "u-1",
    identifier: "ENG-1",
    title: "t",
    description: null,
    url: "https://linear.app/x/issue/ENG-1",
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

/** Capture every `fetchByGet(inc, excl)` call so the exclusion-union wiring is
 *  asserted directly. */
function makeResolvers() {
  const fetchByGetCalls: { inc: unknown; excl: Marker[] }[] = [];
  const applyCalls: { issue: TrackedIssue; ind: SetIndicator }[] = [];
  const removeCalls: { issue: TrackedIssue; ind: SetIndicator }[] = [];
  return {
    fetchByGetCalls,
    applyCalls,
    removeCalls,
    resolvers: {
      applyIndicator: async (issue: TrackedIssue, ind: SetIndicator) => {
        applyCalls.push({ issue, ind });
      },
      removeIndicator: async (issue: TrackedIssue, ind: SetIndicator) => {
        removeCalls.push({ issue, ind });
      },
      applyMarker: async () => {},
      resolveLabelId: async () => null,
      fetchByGet: async (inc: SetIndicator | { filter: Marker[] } | undefined, excl: Marker[]) => {
        fetchByGetCalls.push({ inc, excl });
        return [makeIssue()];
      },
      resolveLabelIdForTeam: async () => null,
    },
  };
}

const getTodo: GetIndicator = { filter: [{ type: "label", value: "todo" }] };
const getInProgress: GetIndicator = { filter: [{ type: "status", value: "In Progress" }] };
const getReview: GetIndicator = { filter: [{ type: "status", value: "In Review" }] };
const setDone: SetIndicator = { type: "status", value: "Done" };
const setError: SetIndicator = { type: "label", value: "ralphy:error" };

function makeIndicators(): Indicators {
  return { getTodo, getInProgress, getReview, setDone, setError };
}

describe("createLinearTrackerProvider", () => {
  test("fetchTodo excludes setDone + setError markers", async () => {
    const { resolvers, fetchByGetCalls } = makeResolvers();
    const provider = createLinearTrackerProvider({
      apiKey: "k",
      team: "ENG",
      assignee: undefined,
      anyAssignee: undefined,
      scope: { requireAllLabels: [] },
      indicators: makeIndicators(),
      resolvers,
      fetchMentions: async () => [],
    });

    await provider.fetchTodo();
    expect(fetchByGetCalls).toHaveLength(1);
    expect(fetchByGetCalls[0]!.inc).toBe(getTodo);
    expect(fetchByGetCalls[0]!.excl).toEqual([
      { type: "status", value: "Done" },
      { type: "label", value: "ralphy:error" },
    ]);
  });

  test("fetchInProgress excludes setError only; fetchReview excludes nothing", async () => {
    const { resolvers, fetchByGetCalls } = makeResolvers();
    const provider = createLinearTrackerProvider({
      apiKey: "k",
      team: "ENG",
      assignee: undefined,
      anyAssignee: undefined,
      scope: { requireAllLabels: [] },
      indicators: makeIndicators(),
      resolvers,
      fetchMentions: async () => [],
    });

    await provider.fetchInProgress();
    expect(fetchByGetCalls[0]!.inc).toBe(getInProgress);
    expect(fetchByGetCalls[0]!.excl).toEqual([{ type: "label", value: "ralphy:error" }]);

    await provider.fetchReview();
    expect(fetchByGetCalls[1]!.inc).toBe(getReview);
    expect(fetchByGetCalls[1]!.excl).toEqual([]);
  });

  test("applyIndicator / removeIndicator / fetchMentions delegate straight through", async () => {
    const { resolvers, applyCalls, removeCalls } = makeResolvers();
    const issue = makeIssue();
    const mention = {
      issue,
      trigger: {
        source: "linear" as const,
        body: "@ralphy do x",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const provider = createLinearTrackerProvider({
      apiKey: "k",
      team: "ENG",
      assignee: undefined,
      anyAssignee: undefined,
      scope: { requireAllLabels: [] },
      indicators: makeIndicators(),
      resolvers,
      fetchMentions: async () => [mention],
    });

    await provider.applyIndicator(issue, setDone);
    await provider.removeIndicator(issue, setError);
    expect(applyCalls).toEqual([{ issue, ind: setDone }]);
    expect(removeCalls).toEqual([{ issue, ind: setError }]);
    expect(await provider.fetchMentions()).toEqual([mention]);
  });

  test("postComment posts via the issue id; fetchComments projects to { body }", async () => {
    addIssueCommentCalls.length = 0;
    fetchIssueCommentsCalls.length = 0;
    const { resolvers } = makeResolvers();
    const issue = makeIssue();
    const provider = createLinearTrackerProvider({
      apiKey: "k",
      team: "ENG",
      assignee: undefined,
      anyAssignee: undefined,
      scope: { requireAllLabels: [] },
      indicators: makeIndicators(),
      resolvers,
      fetchMentions: async () => [],
    });

    await provider.postComment(issue, "ship it");
    expect(addIssueCommentCalls).toEqual([{ issueId: "u-1", body: "ship it" }]);

    const comments = await provider.fetchComments("u-1");
    expect(fetchIssueCommentsCalls).toEqual(["u-1"]);
    expect(comments).toEqual([{ body: "hello" }, { body: "world" }]);
  });

  test("fetchDoneCandidates normalizes an empty ticket list to undefined", async () => {
    fetchDoneCandidatesCalls.length = 0;
    const { resolvers } = makeResolvers();
    const indicators = makeIndicators();

    const noTickets = createLinearTrackerProvider({
      apiKey: "k",
      team: "ENG",
      assignee: "me",
      anyAssignee: false,
      scope: { requireAllLabels: ["bug"] },
      indicators,
      resolvers,
      fetchMentions: async () => [],
      ticketNumbers: [],
    });
    await noTickets.fetchDoneCandidates();
    expect(fetchDoneCandidatesCalls[0]).toEqual([
      "k",
      "ENG",
      "me",
      false,
      { requireAllLabels: ["bug"] },
      indicators,
      undefined,
    ]);

    const withTickets = createLinearTrackerProvider({
      apiKey: "k",
      team: "ENG",
      assignee: "me",
      anyAssignee: true,
      scope: { requireAllLabels: [] },
      indicators,
      resolvers,
      fetchMentions: async () => [],
      ticketNumbers: [12, 34],
    });
    await withTickets.fetchDoneCandidates();
    expect(fetchDoneCandidatesCalls[1]).toEqual([
      "k",
      "ENG",
      "me",
      true,
      { requireAllLabels: [] },
      indicators,
      [12, 34],
    ]);
  });
});
