/**
 * Provider-seam contract test (RLF-241).
 *
 * This test pins the tracker-neutral seam — the `IssueTrackerProvider` method
 * bag and the `TrackedIssue` / `TrackedComment` / `MentionTrigger` shapes — so
 * a future tracker (Jira, GitHub Projects v2, a webhook source) can be added by
 * implementing exactly this surface, and a core refactor that silently narrows
 * or closes the seam fails loudly.
 *
 * Contract rules:
 *  - REMOVALS fail at compile time: a removed/renamed field breaks the
 *    `satisfies` fixtures and the `Expect<Equal<keyof …>>` assertions, so
 *    `tsc -b` (the package `typecheck` target) goes red.
 *  - ADDITIONS require a deliberate one-line edit to the `EXPECTED_*` arrays
 *    below: adding a method/field without updating the expected set fails the
 *    runtime assertions under `bun test`. A new field is a reviewed seam change
 *    — exactly when you want this test to make you look.
 *  - This file MUST import the seam types only from `@ralphy/tracker`'s public
 *    entry, never from a concrete `Linear*` / `Github*` adapter, so it
 *    documents precisely what a third tracker must satisfy.
 */

import { describe, expect, test } from "bun:test";
import type {
  IssueTracker,
  IssueTrackerProvider,
  MentionTrigger,
  PollSnapshot,
  TrackedComment,
  TrackedIssue,
} from "@ralphy/tracker";
import type { RalphyCommentType } from "@ralphy/comms";
import type { SetIndicator } from "@ralphy/types";

// --- Type-level assertion helpers (standard conditional-type identity trick) ---
// No runtime cost and no new dependency; unused type aliases are not flagged by
// `noUnusedLocals` (only runtime locals are).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// 1. IssueTrackerProvider — the nine-method bag
// ---------------------------------------------------------------------------

const EXPECTED_PROVIDER_METHODS = [
  "fetchTodo",
  "fetchInProgress",
  "fetchReview",
  "fetchMentions",
  "fetchDoneCandidates",
  "fetchComments",
  "applyIndicator",
  "removeIndicator",
  "postComment",
] as const;

// `satisfies` forces this reference object to implement every method of the
// interface. Removing a method from `IssueTrackerProvider` makes this an
// incomplete implementation and fails typecheck.
const referenceProvider = {
  async fetchTodo() {
    return [];
  },
  async fetchInProgress() {
    return [];
  },
  async fetchReview() {
    return [];
  },
  async fetchMentions() {
    return [];
  },
  async fetchDoneCandidates() {
    return [];
  },
  async fetchComments(_issueId: string) {
    return [];
  },
  async applyIndicator(_issue: TrackedIssue, _ind: SetIndicator) {},
  async removeIndicator(_issue: TrackedIssue, _ind: SetIndicator) {},
  async postComment(_issue: TrackedIssue, _body: string) {},
} satisfies IssueTrackerProvider;

// ---------------------------------------------------------------------------
// 1b. IssueTracker — the complete facade (issue #403)
// ---------------------------------------------------------------------------

const EXPECTED_TRACKER_METHODS = [
  "poll",
  "applyIndicator",
  "removeIndicator",
  "postComment",
  "fetchComments",
  "upsertStickyComment",
  "fetchPullRequestLinks",
  "fetchBlockers",
  "attachments",
] as const;

const referenceTracker = {
  async poll(): Promise<PollSnapshot> {
    return { todo: [], inProgress: [], mentions: [], doneCandidates: [] };
  },
  async applyIndicator(_issue: TrackedIssue, _ind: SetIndicator) {},
  async removeIndicator(_issue: TrackedIssue, _ind: SetIndicator) {},
  async postComment(_issue: TrackedIssue, _body: string) {},
  async fetchComments(_issueId: string) {
    return [];
  },
  async upsertStickyComment(_issue: TrackedIssue, _type: RalphyCommentType, _body: string) {},
  async fetchPullRequestLinks(_issue: TrackedIssue) {
    return [];
  },
  async fetchBlockers(_issueId: string) {
    return [];
  },
  attachments: null,
} satisfies IssueTracker;

// ---------------------------------------------------------------------------
// 2. TrackedIssue — fully-populated fixture pinning every field
// ---------------------------------------------------------------------------

type ExpectedTrackedIssueKeys =
  | "id"
  | "identifier"
  | "title"
  | "description"
  | "url"
  | "state"
  | "assignee"
  | "project"
  | "milestone"
  | "labels"
  | "priority"
  | "createdAt"
  | "blockedByIds"
  | "blockedByIdentifiers"
  | "comments";

// Every field set, including the optional `milestone`, `blockedByIdentifiers`,
// and `comments`, so `satisfies` exercises the full shape.
const trackedIssueFixture = {
  id: "issue-1",
  identifier: "ENG-123",
  title: "Example issue",
  description: "An example issue body",
  url: "https://example.com/ENG-123",
  state: { name: "In Progress", type: "started" },
  assignee: { id: "user-1", email: "dev@example.com", name: "Dev" },
  project: { id: "proj-1", name: "Core", priority: 2 },
  milestone: { id: "ms-1", name: "M1", sortOrder: 1, targetDate: "2026-01-01" },
  labels: ["bug", "p1"],
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: ["issue-0"],
  blockedByIdentifiers: ["ENG-100"],
  comments: [
    {
      id: "comment-1",
      body: "a comment",
      createdAt: "2026-01-02T00:00:00.000Z",
      user: { name: "Dev", email: "dev@example.com" },
    },
  ],
} satisfies TrackedIssue;

const REQUIRED_TRACKED_ISSUE_KEYS = [
  "id",
  "identifier",
  "title",
  "description",
  "url",
  "state",
  "assignee",
  "project",
  "labels",
  "priority",
  "createdAt",
  "blockedByIds",
] as const;

// ---------------------------------------------------------------------------
// 3. TrackedComment
// ---------------------------------------------------------------------------

type ExpectedTrackedCommentKeys = "id" | "body" | "createdAt" | "user";

const trackedCommentFixture = {
  id: "comment-1",
  body: "a comment",
  createdAt: "2026-01-02T00:00:00.000Z",
  user: { name: "Dev", email: "dev@example.com" },
} satisfies TrackedComment;

const REQUIRED_TRACKED_COMMENT_KEYS = ["id", "body", "createdAt", "user"] as const;

// ---------------------------------------------------------------------------
// 4. MentionTrigger
// ---------------------------------------------------------------------------

type ExpectedMentionTriggerKeys = "source" | "body" | "createdAt" | "author" | "url";

const mentionTriggerFixture = {
  source: "linear",
  body: "@ralphy please review",
  createdAt: "2026-01-02T00:00:00.000Z",
  author: "Dev",
  url: "https://example.com/comment/1",
} satisfies MentionTrigger;

// Pin the `source` union: each member must be assignable, and no other literal.
const MENTION_SOURCES = ["linear", "github", "github-review"] as const;

// ---------------------------------------------------------------------------
// Runtime assertions (red/green under `bun test`)
// ---------------------------------------------------------------------------

describe("provider-seam contract", () => {
  test("IssueTrackerProvider has exactly the nine expected methods", () => {
    const keys = Object.keys(referenceProvider).sort();
    expect(keys).toEqual([...EXPECTED_PROVIDER_METHODS].sort());
  });

  test("IssueTracker facade has exactly the expected surface", () => {
    const keys = Object.keys(referenceTracker).sort();
    expect(keys).toEqual([...EXPECTED_TRACKER_METHODS].sort());
  });

  test("TrackedIssue fixture has every required field", () => {
    for (const key of REQUIRED_TRACKED_ISSUE_KEYS) {
      expect(trackedIssueFixture).toHaveProperty(key);
    }
  });

  test("TrackedComment fixture has every required field", () => {
    for (const key of REQUIRED_TRACKED_COMMENT_KEYS) {
      expect(trackedCommentFixture).toHaveProperty(key);
    }
  });

  test("seam shapes match their expected key unions (compile-time pins)", () => {
    // Each tuple element is typed `Expect<Equal<…>>`, which resolves to `true`
    // only when the seam's `keyof` equals the expected union exactly. A removed,
    // renamed, or added field collapses the `Equal` to `false` and fails
    // typecheck here; the runtime `toEqual` keeps the pin visible under `bun test`.
    const pins: [
      Expect<Equal<keyof TrackedIssue, ExpectedTrackedIssueKeys>>,
      Expect<Equal<keyof TrackedComment, ExpectedTrackedCommentKeys>>,
      Expect<Equal<keyof MentionTrigger, ExpectedMentionTriggerKeys>>,
      Expect<Equal<MentionTrigger["source"], (typeof MENTION_SOURCES)[number]>>,
    ] = [true, true, true, true];
    expect(pins).toEqual([true, true, true, true]);
  });

  test("MentionTrigger source accepts each member of the union", () => {
    for (const source of MENTION_SOURCES) {
      const trigger = { ...mentionTriggerFixture, source } satisfies MentionTrigger;
      expect(trigger.source).toBe(source);
    }
  });
});
