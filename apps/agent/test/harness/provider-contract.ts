import { describe, expect, test } from "bun:test";
import { parseRalphyMarker } from "@ralphy/comms";
import type { SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import { createIssueTracker, type IssueTracker, type IssueTrackerExtras } from "@ralphy/tracker";
import { createFakeLinear, type FakeLinearIndicators } from "./fake-linear";
import type { AppliedLog, FakeLinearComment, SeedIssue } from "./types";

/** Which fetch bucket an issue is seeded into by {@link ProviderContractBackend.seedInBucket}. */
export type ContractBucket = "todo" | "inProgress" | "review" | "doneCandidate";

/** Origin of a pushed mention, mirroring `MentionTrigger.source`. */
export type MentionSource = "linear" | "github" | "github-review";

/**
 * The backend adapter the contract kit is parametrized over. Any issue-tracker
 * fake (FakeLinear today, a future FakeGithub) implements this interface once
 * and plugs straight into {@link runProviderContract} with zero kit edits.
 *
 * The kit asserts *behavior* — which bucket an issue lands in and what the
 * applied log records — never the exact marker spelling. The adapter is free to
 * choose whatever markers make those transitions observable in its fake.
 */
export interface ProviderContractBackend {
  /** Provider surface under test. */
  readonly client: IssueTrackerProvider;
  /** Side-effect log the provider writes through. */
  readonly applied: AppliedLog;

  /** Seed an issue already placed in `bucket` so the matching `fetch*` returns
   *  it. The adapter chooses the bucket markers (see the Linear adapter). */
  seedInBucket(bucket: ContractBucket, seed: SeedIssue): TrackedIssue;

  /** Indicators the kit feeds to `client.applyIndicator` /
   *  `client.removeIndicator`. The adapter guarantees these transitions are
   *  observable through the fetch buckets and the applied log. */
  readonly set: {
    inProgress: SetIndicator;
    done: SetIndicator;
    prReady: SetIndicator;
    error: SetIndicator;
    /** Removed (not applied) to exercise `clearReview`. */
    review: SetIndicator;
  };

  /** Optional: a backend that substitutes the `attachment` marker with a sticky
   *  upserted comment opts in by exposing it. The kit then asserts repeated
   *  applies leave exactly one marker comment carrying the latest body. Backends
   *  that honour attachments natively (Linear) leave it unset and the cases skip. */
  readonly attachmentMarker?: SetIndicator;

  pushComment(issueId: string, body: string, author?: string): void;
  pushMention(issueId: string, source: MentionSource, body: string, at: Date): void;
  comments(issueId: string): readonly FakeLinearComment[];
  issues(): readonly TrackedIssue[];
}

const ids = (issues: readonly TrackedIssue[]): string[] => issues.map((i) => i.identifier);

/**
 * Backend-parametrized provider contract. Call it at the top level of a
 * `*.test.ts` file with a fresh-backend factory; every case obtains its own
 * isolated backend via `makeBackend()` so exclusion assertions never become
 * order-dependent.
 */
export function runProviderContract(makeBackend: () => ProviderContractBackend): void {
  describe("provider contract", () => {
    describe("fetch buckets", () => {
      test("each fetch* returns only the issue seeded into its bucket", async () => {
        const b = makeBackend();
        b.seedInBucket("todo", { id: "t", identifier: "C-TODO", title: "todo" });
        b.seedInBucket("inProgress", { id: "p", identifier: "C-PROG", title: "in progress" });
        b.seedInBucket("review", { id: "r", identifier: "C-REVIEW", title: "review" });
        b.seedInBucket("doneCandidate", { id: "d", identifier: "C-DONE", title: "done" });

        expect(ids(await b.client.fetchTodo())).toEqual(["C-TODO"]);
        expect(ids(await b.client.fetchInProgress())).toEqual(["C-PROG"]);
        expect(ids(await b.client.fetchReview())).toEqual(["C-REVIEW"]);
        expect(ids(await b.client.fetchDoneCandidates())).toEqual(["C-DONE"]);
      });
    });

    describe("round-trips", () => {
      test("postComment then fetchComments returns the body", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("todo", { id: "1", identifier: "C-1", title: "x" });
        await b.client.postComment(issue, "hello");
        const bodies = (await b.client.fetchComments(issue.id)).map((c) => c.body);
        expect(bodies).toContain("hello");
      });

      test("human pushComment is surfaced by fetchComments", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("todo", { id: "1", identifier: "C-1", title: "x" });
        b.pushComment(issue.id, "human note", "Alice");
        const bodies = (await b.client.fetchComments(issue.id)).map((c) => c.body);
        expect(bodies).toContain("human note");
      });

      test("pushMention surfaces via fetchMentions with body + source", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("todo", { id: "1", identifier: "C-1", title: "x" });
        b.pushMention(issue.id, "linear", "@ralphy ping", new Date("2025-01-02T00:00:00Z"));
        const mentions = await b.client.fetchMentions();
        expect(mentions).toHaveLength(1);
        expect(mentions[0]?.trigger.body).toBe("@ralphy ping");
        expect(mentions[0]?.trigger.source).toBe("linear");
      });
    });

    describe("indicator side effects", () => {
      test("applyIndicator(inProgress) records setInProgress", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("todo", { id: "1", identifier: "C-1", title: "x" });
        await b.client.applyIndicator(issue, b.set.inProgress);
        expect(b.applied.setInProgress).toContain("C-1");
      });

      test("removeIndicator(review) records clearReview", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("review", { id: "1", identifier: "C-1", title: "x" });
        await b.client.removeIndicator(issue, b.set.review);
        expect(b.applied.clearReview).toContain("C-1");
      });
    });

    describe("lifecycle exclusion & bucketing", () => {
      test("setInProgress moves an issue out of todo into in-progress", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("todo", { id: "1", identifier: "C-1", title: "x" });
        await b.client.applyIndicator(issue, b.set.inProgress);
        expect(ids(await b.client.fetchTodo())).not.toContain("C-1");
        expect(ids(await b.client.fetchInProgress())).toContain("C-1");
        expect(b.applied.setInProgress).toContain("C-1");
      });

      test("setDone excludes from in-progress and lands in done candidates", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("inProgress", { id: "1", identifier: "C-1", title: "x" });
        await b.client.applyIndicator(issue, b.set.done);
        expect(ids(await b.client.fetchInProgress())).not.toContain("C-1");
        expect(b.applied.setDone).toContain("C-1");
        expect(ids(await b.client.fetchDoneCandidates())).toContain("C-1");
      });

      test("setError excludes from todo", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("todo", { id: "1", identifier: "C-1", title: "x" });
        await b.client.applyIndicator(issue, b.set.error);
        expect(ids(await b.client.fetchTodo())).not.toContain("C-1");
        expect(b.applied.setError).toContain("C-1");
      });

      test("setPrReady is additive and not mis-bucketed as setInProgress", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("todo", { id: "1", identifier: "C-1", title: "x" });
        await b.client.applyIndicator(issue, b.set.prReady);
        expect(b.applied.setPrReady).toContain("C-1");
        expect(b.applied.setInProgress).not.toContain("C-1");
      });

      test("clearReview drops an issue from the review bucket", async () => {
        const b = makeBackend();
        const issue = b.seedInBucket("review", { id: "1", identifier: "C-1", title: "x" });
        await b.client.removeIndicator(issue, b.set.review);
        expect(ids(await b.client.fetchReview())).not.toContain("C-1");
        expect(b.applied.clearReview).toContain("C-1");
      });
    });

    // Gated on the optional `attachmentMarker` hook: a backend that substitutes
    // the attachment marker with a sticky comment (GitHub) opts in; one that
    // honours attachments natively (Linear) leaves it unset and these skip.
    const probe = makeBackend();
    const itAttach = probe.attachmentMarker ? test : test.skip;
    describe("sticky attachment upsert", () => {
      itAttach("repeated applies leave exactly one attachment comment, latest body", async () => {
        const b = makeBackend();
        const marker = b.attachmentMarker!;
        const subtitle = markersOf(marker).find((m) => m.type === "attachment")!.value;
        const issue = b.seedInBucket("inProgress", { id: "1", identifier: "C-1", title: "x" });
        for (let i = 0; i < 3; i++) await b.client.applyIndicator(issue, marker);

        const bodies = (await b.client.fetchComments(issue.id)).map((c) => c.body);
        const stuck = bodies.filter((body) => parseRalphyMarker(body)?.type === "attachment");
        expect(stuck).toHaveLength(1);
        expect(stuck[0]).toContain(subtitle);
      });
    });
  });
}

// --- Linear adapter ---------------------------------------------------------

/**
 * Mutually-exclusive, status-based lifecycle vocabulary. Status buckets never
 * overlap, so a transition that changes an issue's status genuinely removes it
 * from one bucket and adds it to another — which is what makes exclusion
 * observable in `FakeLinear`, whose `filterBy` is OR-only with no `exclude`.
 * The `review` bucket is label-driven and parked on a neutral `In Review`
 * status so it never leaks into the status-keyed `Todo` bucket.
 */
const LINEAR_INDICATORS: FakeLinearIndicators = {
  getTodo: { filter: [{ type: "status", value: "Todo" }] },
  getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
  getReview: { filter: [{ type: "label", value: "ralphy:review" }] },
  getDoneCandidates: { filter: [{ type: "status", value: "Done" }] },
};

const BUCKET_STATE: Record<ContractBucket, { name: string; type: string }> = {
  todo: { name: "Todo", type: "unstarted" },
  inProgress: { name: "In Progress", type: "started" },
  review: { name: "In Review", type: "started" },
  doneCandidate: { name: "Done", type: "completed" },
};

/**
 * Linear adapter wiring `createFakeLinear` into the contract kit. Each call
 * returns a fresh, isolated backend.
 */
export function makeLinearContractBackend(): ProviderContractBackend {
  const fake = createFakeLinear(LINEAR_INDICATORS);
  return {
    client: fake.client,
    applied: fake.applied,
    seedInBucket: (bucket, seed) => {
      const labels =
        bucket === "review" ? [...(seed.labels ?? []), "ralphy:review"] : (seed.labels ?? []);
      return fake.seed({ ...seed, state: BUCKET_STATE[bucket], labels });
    },
    set: {
      inProgress: { type: "status", value: "In Progress" },
      done: { type: "status", value: "Done" },
      prReady: { type: "status", value: "In Review" },
      error: { type: "status", value: "Error" },
      review: { type: "label", value: "ralphy:review" },
    },
    pushComment: fake.pushComment,
    pushMention: fake.pushMention,
    comments: fake.comments,
    issues: fake.issues,
  };
}

/**
 * Build an {@link IssueTracker} facade from a sparse bag of flat provider
 * methods — the migration shim for tests written against the pre-#403
 * nine-method `CoordinatorDeps`. Unspecified reads return empty; unspecified
 * writes are no-ops; the capability extras (sticky upsert, PR links,
 * blockers) default to inert implementations unless overridden.
 *
 * Delegation is late-bound: reassigning a method on the `methods` bag after
 * construction takes effect on the next call, so tests can keep the
 * `ctx.flat.fetchTodo = async () => …` override pattern.
 */
export function trackerFromFlat(
  methods: Partial<IssueTrackerProvider> = {},
  extras: Partial<IssueTrackerExtras> = {},
): IssueTracker {
  const provider: IssueTrackerProvider = {
    fetchTodo: () => methods.fetchTodo?.() ?? Promise.resolve([]),
    fetchInProgress: () => methods.fetchInProgress?.() ?? Promise.resolve([]),
    fetchReview: () => methods.fetchReview?.() ?? Promise.resolve([]),
    fetchMentions: () => methods.fetchMentions?.() ?? Promise.resolve([]),
    fetchDoneCandidates: () => methods.fetchDoneCandidates?.() ?? Promise.resolve([]),
    fetchComments: (issueId) => methods.fetchComments?.(issueId) ?? Promise.resolve([]),
    applyIndicator: (issue, ind) => methods.applyIndicator?.(issue, ind) ?? Promise.resolve(),
    removeIndicator: (issue, ind) => methods.removeIndicator?.(issue, ind) ?? Promise.resolve(),
    postComment: (issue, body) => methods.postComment?.(issue, body) ?? Promise.resolve(),
  };
  return createIssueTracker(provider, {
    upsertStickyComment: async () => {},
    fetchPullRequestLinks: async () => [],
    fetchBlockers: async () => [],
    ...extras,
  });
}
