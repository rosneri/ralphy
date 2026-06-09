/**
 * `FakeGithub` — an in-memory issue tracker that mirrors `FakeLinear`'s public
 * shape but models GitHub semantics: each issue is **open/closed + labels**
 * (no status field). It exists to prove the backend-neutral provider contract
 * kit (`provider-contract.ts`) is genuinely tracker-agnostic by passing the
 * same suite as the Linear backend.
 *
 * Two GitHub divergences drive the implementation:
 *  1. **Exclusion filtering.** `FakeLinear.filterBy` is OR-only with no
 *     `exclude`, so Linear leans on mutually-exclusive statuses. GitHub
 *     lifecycle is label-only, so the todo bucket needs a negative condition
 *     (open + selection label AND none of the lifecycle labels). FakeGithub
 *     ships its own predicate filter rather than reusing `createFakeLinear`.
 *  2. **done → close.** A "done" indicator flips `open=false` (moving the issue
 *     into the closed/doneCandidates bucket) instead of adding a label. This is
 *     the one place the fake special-cases the indicator, reusing the real
 *     provider's pure `githubIndicatorAction` classifier so the rule stays in
 *     one place.
 */

import { buildRalphyComment, findStickyComment } from "@ralphy/comms";
import type { SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import type { MentionTrigger } from "../../src/queue/queue-order";
import {
  githubIndicatorAction,
  staleStatusLabels,
} from "../../src/agent/wire/tracker/github-tracker-provider";
import type { AppliedLog, FakeLinearComment, SeedIssue } from "./types";

/** Namespace identifying single-valued status labels (mirrors the real provider). */
const STATUS_PREFIX = "status:";
import type { ContractBucket, MentionSource, ProviderContractBackend } from "./provider-contract";

/** GitHub-flavoured marker vocabulary shared by the fake and its adapter. */
export const GITHUB_LABELS = {
  selection: "ralphy:todo",
  inProgress: "status:in-progress",
  review: "status:in-review",
  prReady: "status:pr-ready",
  error: "status:error",
  /** Interpreted as "close" by `githubIndicatorAction`, never stored. */
  done: "status:done",
} as const;

/** Labels whose presence on an open issue excludes it from the todo bucket. */
const LIFECYCLE_LABELS: string[] = [
  GITHUB_LABELS.inProgress,
  GITHUB_LABELS.review,
  GITHUB_LABELS.prReady,
  GITHUB_LABELS.error,
];

export interface FakeGithub {
  client: IssueTrackerProvider;
  seed: (issue: SeedIssue) => TrackedIssue;
  setLabels: (id: string, labels: string[]) => void;
  /** Flip an issue between open (true) and closed (false). */
  setOpen: (id: string, open: boolean) => void;
  pushComment: (issueId: string, body: string, author?: string) => void;
  pushMention: (issueId: string, source: MentionSource, body: string, at: Date) => void;
  comments: (issueId: string) => readonly FakeLinearComment[];
  issues: () => readonly TrackedIssue[];
  applied: AppliedLog;
}

interface IssueRecord {
  issue: TrackedIssue;
  open: boolean;
}

function defaultIssue(seed: SeedIssue): TrackedIssue {
  return {
    id: seed.id,
    identifier: seed.identifier,
    title: seed.title,
    description: seed.description ?? null,
    url: seed.url ?? `https://github.com/test/repo/issues/${seed.id}`,
    state: seed.state ?? { name: "Open", type: "started" },
    assignee: seed.assignee ?? null,
    project: seed.project ?? null,
    labels: seed.labels ?? [],
    priority: seed.priority ?? 3,
    createdAt: seed.createdAt ?? "2025-01-01T00:00:00.000Z",
    blockedByIds: seed.blockedByIds ?? [],
  };
}

export function createFakeGithub(): FakeGithub {
  const records = new Map<string, IssueRecord>();
  const comments = new Map<string, FakeLinearComment[]>();
  const mentions = new Map<string, FakeLinearComment[]>();
  const applied: AppliedLog = {
    setInProgress: [],
    setDone: [],
    setPrReady: [],
    setError: [],
    clearReview: [],
  };

  const has = (i: TrackedIssue, label: string) => i.labels.includes(label);

  /** Which applied-log slot an applied indicator records into. pr-ready is
   *  checked before the broad in-progress fallback so it is never
   *  mis-bucketed (mirrors `FakeLinear.classifyApplied` ordering). */
  function classifyApplied(ind: SetIndicator): keyof AppliedLog | null {
    const action = githubIndicatorAction(ind, "add");
    if (action.kind === "close") return "setDone";
    const labels = action.labels;
    if (labels.includes(GITHUB_LABELS.prReady)) return "setPrReady";
    if (labels.includes(GITHUB_LABELS.inProgress)) return "setInProgress";
    if (labels.includes(GITHUB_LABELS.error)) return "setError";
    return null;
  }

  function addLabels(id: string, labels: string[]): void {
    const rec = records.get(id);
    if (!rec) return;
    const next = [...rec.issue.labels];
    for (const l of labels) if (!next.includes(l)) next.push(l);
    rec.issue = { ...rec.issue, labels: next };
  }

  function removeLabels(id: string, labels: string[]): void {
    const rec = records.get(id);
    if (!rec) return;
    rec.issue = { ...rec.issue, labels: rec.issue.labels.filter((l) => !labels.includes(l)) };
  }

  const client: IssueTrackerProvider = {
    fetchTodo: async () =>
      [...records.values()]
        .filter(
          (r) =>
            r.open &&
            has(r.issue, GITHUB_LABELS.selection) &&
            !r.issue.labels.some((l) => LIFECYCLE_LABELS.includes(l)),
        )
        .map((r) => r.issue),
    fetchInProgress: async () =>
      [...records.values()]
        .filter((r) => r.open && has(r.issue, GITHUB_LABELS.inProgress))
        .map((r) => r.issue),
    fetchReview: async () =>
      [...records.values()]
        .filter((r) => r.open && has(r.issue, GITHUB_LABELS.review))
        .map((r) => r.issue),
    fetchDoneCandidates: async () =>
      [...records.values()].filter((r) => !r.open).map((r) => r.issue),
    fetchComments: async (issueId: string) =>
      (comments.get(issueId) ?? []).map((c) => ({ body: c.body })),
    fetchMentions: async () => {
      const out: { issue: TrackedIssue; trigger: MentionTrigger }[] = [];
      for (const [issueId, list] of mentions) {
        const rec = records.get(issueId);
        if (!rec) continue;
        for (const m of list) {
          out.push({
            issue: rec.issue,
            trigger: {
              source: m.source ?? "github",
              body: m.body,
              createdAt: m.at.toISOString(),
              author: m.author,
            },
          });
        }
      }
      return out;
    },
    applyIndicator: async (issue, ind) => {
      // Attachment markers have no GitHub equivalent; the provider substitutes a
      // sticky-upserted comment, re-discovered by its hidden marker. Mirror that
      // here so the behaviour is observable through fetchComments.
      const attachment = markersOf(ind).find((m) => m.type === "attachment");
      if (attachment) {
        const body = buildRalphyComment({ type: "attachment", action: attachment.value });
        const list = comments.get(issue.id) ?? [];
        const existing = findStickyComment(list, "attachment");
        if (existing) existing.body = body;
        else list.push({ body, author: "ralphy", at: new Date() });
        comments.set(issue.id, list);
        return;
      }
      const key = classifyApplied(ind);
      if (key) applied[key].push(issue.identifier);
      const action = githubIndicatorAction(ind, "add");
      const rec = records.get(issue.id);
      if (!rec) return;
      if (action.kind === "close") {
        rec.open = false;
        rec.issue = { ...rec.issue, state: { name: "Closed", type: "completed" } };
        return;
      }
      // Single-active-status: strip any prior `status:*` label before adding so
      // the open issue carries at most one status label (mirrors the provider).
      const stale = staleStatusLabels(rec.issue.labels, action.labels, STATUS_PREFIX);
      if (stale.length > 0) removeLabels(issue.id, stale);
      addLabels(issue.id, action.labels);
    },
    removeIndicator: async (issue, ind) => {
      const labels = markersOf(ind)
        .filter((m) => m.type === "label")
        .map((m) => m.value);
      if (labels.includes(GITHUB_LABELS.review)) applied.clearReview.push(issue.identifier);
      removeLabels(issue.id, labels);
    },
    postComment: async (issue, body) => {
      const list = comments.get(issue.id) ?? [];
      list.push({ body, author: "ralphy", at: new Date() });
      comments.set(issue.id, list);
    },
  };

  return {
    client,
    applied,
    seed: (s) => {
      const issue = defaultIssue(s);
      records.set(issue.id, { issue, open: true });
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
      const rec = records.get(id);
      if (!rec) throw new Error("fake-github: unknown issue", { cause: { id } });
      rec.issue = { ...rec.issue, labels };
    },
    setOpen: (id, open) => {
      const rec = records.get(id);
      if (!rec) throw new Error("fake-github: unknown issue", { cause: { id } });
      rec.open = open;
      rec.issue = {
        ...rec.issue,
        state: open ? { name: "Open", type: "started" } : { name: "Closed", type: "completed" },
      };
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
    issues: () => [...records.values()].map((r) => r.issue),
  };
}

// --- GitHub contract adapter ------------------------------------------------

/** Labels added to a seed for each contract bucket. doneCandidate carries no
 *  lifecycle label — it is expressed by closing the issue. */
function bucketLabels(bucket: ContractBucket, base: string[]): string[] {
  switch (bucket) {
    case "todo":
      return [...base, GITHUB_LABELS.selection];
    case "inProgress":
      return [...base, GITHUB_LABELS.inProgress];
    case "review":
      return [...base, GITHUB_LABELS.review];
    case "doneCandidate":
      return base;
  }
}

/**
 * GitHub adapter wiring `createFakeGithub` into the contract kit. Lives here
 * (not in `provider-contract.ts`) so the kit stays untouched. Each call returns
 * a fresh, isolated backend.
 */
export function makeGithubContractBackend(): ProviderContractBackend {
  const fake = createFakeGithub();
  return {
    client: fake.client,
    applied: fake.applied,
    seedInBucket: (bucket, seed) => {
      const issue = fake.seed({ ...seed, labels: bucketLabels(bucket, seed.labels ?? []) });
      if (bucket === "doneCandidate") fake.setOpen(issue.id, false);
      return issue;
    },
    set: {
      inProgress: { type: "label", value: GITHUB_LABELS.inProgress },
      // Interpreted as "close" by the provider/fake, not stored as a label.
      done: { type: "label", value: GITHUB_LABELS.done },
      prReady: { type: "label", value: GITHUB_LABELS.prReady },
      error: { type: "label", value: GITHUB_LABELS.error },
      review: { type: "label", value: GITHUB_LABELS.review },
    },
    // GitHub substitutes the unsupported attachment marker with a sticky
    // upserted comment, so it opts into the contract kit's attachment cases.
    attachmentMarker: { type: "attachment", value: "design ready" },
    pushComment: fake.pushComment,
    pushMention: fake.pushMention,
    comments: fake.comments,
    issues: fake.issues,
  };
}
