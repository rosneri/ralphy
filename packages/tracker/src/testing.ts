/**
 * `@ralphy/tracker/testing` — fully in-memory {@link IssueTracker} for
 * orchestration tests (coordinator, comment-sync, spec-sink). No transport,
 * no transcripts: script the buckets, read back the writes.
 */

import { findStickyComment, type RalphyCommentType } from "@ralphy/comms";
import type { SetIndicator } from "@ralphy/types";
import { ensureStickyMarker } from "./facade";
import type { TrackedIssue } from "./issue";
import type { MentionTrigger } from "./mention";
import type { IssueAttachments, IssueTracker, PollSnapshot } from "./tracker";

export interface InMemoryComment {
  id: string;
  body: string;
}

export interface InMemoryAttachment {
  id: string;
  issueId: string;
  url: string;
  title: string;
  subtitle?: string;
}

export interface InMemoryIssueTrackerOptions {
  /** When true, the tracker exposes an in-memory `attachments` capability
   *  (the Linear-like shape); when false/omitted, `attachments` is null
   *  (the GitHub-like shape). */
  withAttachments?: boolean;
}

/**
 * In-memory {@link IssueTracker}. Buckets are plain public arrays — set them
 * in a test, then drive `poll()`. Comment IO and the sticky upsert behave like
 * the real adapters (marker re-discovery, edit in place), so idempotency
 * properties are observable without a backend.
 */
export class InMemoryIssueTracker implements IssueTracker {
  todo: TrackedIssue[] = [];
  inProgress: TrackedIssue[] = [];
  mentions: { issue: TrackedIssue; trigger: MentionTrigger }[] = [];
  doneCandidates: TrackedIssue[] = [];

  /** Comments per issue id, in post order. */
  readonly commentsByIssue = new Map<string, InMemoryComment[]>();
  /** Indicator writes, for assertions. */
  readonly applied: { issue: TrackedIssue; indicator: SetIndicator }[] = [];
  readonly removed: { issue: TrackedIssue; indicator: SetIndicator }[] = [];
  /** Scriptable PR links / blockers per issue id. */
  readonly prLinksByIssue = new Map<string, string[]>();
  readonly blockersByIssue = new Map<string, { id: string; identifier: string }[]>();
  /** Uploads + attachments recorded by the in-memory capability. */
  readonly uploads: { filename: string; contentType: string; bytes: Uint8Array }[] = [];
  readonly attachmentsStore: InMemoryAttachment[] = [];

  readonly attachments: IssueAttachments | null;

  private nextId = 0;

  constructor(options: InMemoryIssueTrackerOptions = {}) {
    this.attachments = options.withAttachments ? this.buildAttachments() : null;
  }

  async poll(): Promise<PollSnapshot> {
    return {
      todo: [...this.todo],
      inProgress: [...this.inProgress],
      mentions: [...this.mentions],
      doneCandidates: [...this.doneCandidates],
    };
  }

  async applyIndicator(issue: TrackedIssue, indicator: SetIndicator): Promise<void> {
    this.applied.push({ issue, indicator });
  }

  async removeIndicator(issue: TrackedIssue, indicator: SetIndicator): Promise<void> {
    this.removed.push({ issue, indicator });
  }

  async postComment(issue: TrackedIssue, body: string): Promise<void> {
    this.commentsOf(issue.id).push({ id: this.id("comment"), body });
  }

  async fetchComments(issueId: string): Promise<{ body: string }[]> {
    return this.commentsOf(issueId).map((c) => ({ body: c.body }));
  }

  async upsertStickyComment(
    issue: TrackedIssue,
    type: RalphyCommentType,
    body: string,
  ): Promise<void> {
    const comments = this.commentsOf(issue.id);
    const stamped = ensureStickyMarker(type, body);
    const existing = findStickyComment(comments, type);
    if (existing) {
      existing.body = stamped;
      return;
    }
    comments.push({ id: this.id("comment"), body: stamped });
  }

  async fetchPullRequestLinks(issue: TrackedIssue): Promise<string[]> {
    return [...(this.prLinksByIssue.get(issue.id) ?? [])];
  }

  async fetchBlockers(issueId: string): Promise<{ id: string; identifier: string }[]> {
    return [...(this.blockersByIssue.get(issueId) ?? [])];
  }

  /** The sticky comment of `type` on `issueId`, or null — for assertions. */
  stickyComment(issueId: string, type: RalphyCommentType): InMemoryComment | null {
    return findStickyComment(this.commentsOf(issueId), type);
  }

  private commentsOf(issueId: string): InMemoryComment[] {
    let comments = this.commentsByIssue.get(issueId);
    if (!comments) {
      comments = [];
      this.commentsByIssue.set(issueId, comments);
    }
    return comments;
  }

  private id(prefix: string): string {
    this.nextId += 1;
    return `${prefix}-${this.nextId}`;
  }

  private buildAttachments(): IssueAttachments {
    return {
      uploadFile: async (input) => {
        this.uploads.push(input);
        return `https://uploads.example/${this.id("asset")}/${input.filename}`;
      },
      attachUrl: async (issueId, url, title, subtitle) => {
        const id = this.id("attachment");
        this.attachmentsStore.push(
          subtitle === undefined
            ? { id, issueId, url, title }
            : { id, issueId, url, title, subtitle },
        );
        return id;
      },
      findByTitle: async (issueId, title) => {
        const match = this.attachmentsStore.find((a) => a.issueId === issueId && a.title === title);
        return match?.id ?? null;
      },
      delete: async (attachmentId) => {
        const i = this.attachmentsStore.findIndex((a) => a.id === attachmentId);
        if (i >= 0) this.attachmentsStore.splice(i, 1);
      },
    };
  }
}

/** A minimal valid TrackedIssue for tests; override what matters. */
export function makeTrackedIssue(overrides: Partial<TrackedIssue> = {}): TrackedIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Example",
    description: null,
    url: "https://example.com/ENG-1",
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    priority: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
    ...overrides,
  };
}
