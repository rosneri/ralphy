import type { GetIndicator, SetIndicator, Marker } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import { issueMatchesGetIndicator } from "../../src/shared/capabilities/linear-client";
import type { AppliedLog, FakeLinearComment, SeedIssue } from "./types";
import type { MentionTrigger } from "../../src/queue/queue-order";

export interface FakeLinearIndicators {
  getTodo?: GetIndicator;
  getInProgress?: GetIndicator;
  getReview?: GetIndicator;
  getDoneCandidates?: GetIndicator;
}

export interface FakeLinear {
  client: IssueTrackerProvider;
  indicators: FakeLinearIndicators;
  seed: (issue: SeedIssue) => TrackedIssue;
  setLabels: (id: string, labels: string[]) => void;
  setStatus: (id: string, name: string, type: string) => void;
  pushComment: (issueId: string, body: string, author?: string) => void;
  pushMention: (
    issueId: string,
    source: "linear" | "github" | "github-review",
    body: string,
    at: Date,
  ) => void;
  comments: (issueId: string) => readonly FakeLinearComment[];
  issues: () => readonly TrackedIssue[];
  applied: AppliedLog;
}

function defaultIssue(seed: SeedIssue): TrackedIssue {
  return {
    id: seed.id,
    identifier: seed.identifier,
    title: seed.title,
    description: seed.description ?? null,
    url: seed.url ?? `https://linear.app/test/issue/${seed.identifier}`,
    state: seed.state ?? { name: "Todo", type: "unstarted" },
    assignee: seed.assignee ?? null,
    project: seed.project ?? null,
    labels: seed.labels ?? [],
    priority: seed.priority ?? 3,
    createdAt: seed.createdAt ?? "2025-01-01T00:00:00.000Z",
    blockedByIds: seed.blockedByIds ?? [],
  };
}

function applyMarkers(issue: TrackedIssue, markers: Marker[]): TrackedIssue {
  let next = issue;
  for (const m of markers) {
    if (m.type === "label") {
      if (!next.labels.includes(m.value)) {
        next = { ...next, labels: [...next.labels, m.value] };
      }
    } else if (m.type === "status") {
      next = { ...next, state: { name: m.value, type: "started" } };
    } else if (m.type === "project") {
      next = { ...next, project: { id: m.value, name: m.value } };
    }
    // attachment markers are a no-op in the fake.
  }
  return next;
}

function removeMarkers(issue: TrackedIssue, markers: Marker[]): TrackedIssue {
  let next = issue;
  for (const m of markers) {
    if (m.type === "label") {
      next = { ...next, labels: next.labels.filter((l) => l !== m.value) };
    }
  }
  return next;
}

export function createFakeLinear(indicators: FakeLinearIndicators = {}): FakeLinear {
  const issues = new Map<string, TrackedIssue>();
  const comments = new Map<string, FakeLinearComment[]>();
  const mentions = new Map<string, FakeLinearComment[]>();
  const applied: AppliedLog = {
    setInProgress: [],
    setDone: [],
    setPrReady: [],
    setError: [],
    clearReview: [],
  };

  function classifyApplied(ind: SetIndicator): keyof AppliedLog | null {
    const markers = markersOf(ind);
    const labels = markers.filter((m) => m.type === "label").map((m) => m.value.toLowerCase());
    const statuses = markers.filter((m) => m.type === "status").map((m) => m.value.toLowerCase());
    if (statuses.includes("done") || labels.includes("ralphy:done")) return "setDone";
    // setPrReady is content-distinguished and MUST be checked before the broad
    // setInProgress fallback so its "in review" / "ralphy:pr-ready" marker is
    // not mis-bucketed.
    if (statuses.includes("in review") || labels.includes("ralphy:pr-ready")) return "setPrReady";
    if (statuses.includes("in progress") || labels.includes("ralphy:in-progress")) {
      return "setInProgress";
    }
    if (labels.includes("ralphy:error") || statuses.includes("error")) return "setError";
    return null;
  }

  const filterBy = (ind: GetIndicator | undefined): TrackedIssue[] => {
    if (!ind) return [];
    return [...issues.values()].filter((i) => {
      const issueComments = (comments.get(i.id) ?? []).map((c) => ({
        body: c.body,
        user: { name: c.author },
      }));
      return issueMatchesGetIndicator({ ...i, comments: issueComments }, ind);
    });
  };

  const client: IssueTrackerProvider = {
    fetchTodo: async () => filterBy(indicators.getTodo),
    fetchInProgress: async () => filterBy(indicators.getInProgress),
    fetchReview: async () => filterBy(indicators.getReview),
    fetchDoneCandidates: async () => filterBy(indicators.getDoneCandidates),
    fetchMentions: async () => {
      const out: { issue: TrackedIssue; trigger: MentionTrigger }[] = [];
      for (const [issueId, list] of mentions) {
        const issue = issues.get(issueId);
        if (!issue) continue;
        for (const m of list) {
          out.push({
            issue,
            trigger: {
              source: m.source ?? "linear",
              body: m.body,
              createdAt: m.at.toISOString(),
              author: m.author,
            },
          });
        }
      }
      return out;
    },
    fetchComments: async (issueId: string) =>
      (comments.get(issueId) ?? []).map((c) => ({ body: c.body })),
    applyIndicator: async (issue, ind) => {
      const key = classifyApplied(ind);
      if (key) applied[key].push(issue.identifier);
      const cur = issues.get(issue.id) ?? issue;
      issues.set(issue.id, applyMarkers(cur, markersOf(ind)));
    },
    removeIndicator: async (issue, ind) => {
      const markers = markersOf(ind);
      const labels = markers.filter((m) => m.type === "label").map((m) => m.value.toLowerCase());
      if (labels.includes("ralphy:review")) applied.clearReview.push(issue.identifier);
      const cur = issues.get(issue.id) ?? issue;
      issues.set(issue.id, removeMarkers(cur, markers));
    },
    postComment: async (issue, body) => {
      const list = comments.get(issue.id) ?? [];
      list.push({ body, author: "ralphy", at: new Date() });
      comments.set(issue.id, list);
    },
  };

  return {
    client,
    indicators,
    applied,
    seed: (s) => {
      const issue = defaultIssue(s);
      issues.set(issue.id, issue);
      if (s.comments && s.comments.length > 0) {
        const list = comments.get(issue.id) ?? [];
        for (const c of s.comments) {
          list.push({ body: c.body, author: c.author ?? "human", at: new Date() });
        }
        comments.set(issue.id, list);
      }
      return issue;
    },
    setLabels: (id, labels) => {
      const cur = issues.get(id);
      if (!cur) throw new Error("fake-linear: unknown issue", { cause: { id } });
      issues.set(id, { ...cur, labels });
    },
    setStatus: (id, name, type) => {
      const cur = issues.get(id);
      if (!cur) throw new Error("fake-linear: unknown issue", { cause: { id } });
      issues.set(id, { ...cur, state: { name, type } });
    },
    pushComment: (issueId, body, author = "human") => {
      const list = comments.get(issueId) ?? [];
      list.push({ body, author, at: new Date() });
      comments.set(issueId, list);
    },
    pushMention: (issueId, source, body, at) => {
      const list = mentions.get(issueId) ?? [];
      list.push({ body, author: "human", at, source });
      mentions.set(issueId, list);
    },
    comments: (issueId) => comments.get(issueId) ?? [],
    issues: () => [...issues.values()],
  };
}
