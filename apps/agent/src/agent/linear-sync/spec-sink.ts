/**
 * `SpecSink` — the seam between "the loop has spec content to publish" and
 * "how this tracker records it" (RLF-239).
 *
 * Two implementations:
 *  - {@link createAttachmentSpecSink} — Linear: the existing attachment slots
 *    (`syncSpecAttachments`, md + optional PDF mirror), driven through the
 *    tracker's `attachments` capability. Behavior unchanged.
 *  - {@link createCommentSpecSink} — GitHub: the spec content embedded in a
 *    single marker-tagged sticky comment (built on the sticky-upsert
 *    primitive), re-discovered and edited in place across iterations. A
 *    content sha in the marker makes re-syncs of identical content a no-op.
 *
 * Selection happens where the tracker is constructed (`createTracker` — the
 * one place `tracker.kind` is read): a backend with an `attachments`
 * capability gets the attachment sink, one without gets the comment sink.
 */

import { buildRalphyComment, parseRalphyMarker, type RalphyCommentType } from "@ralphy/comms";
import type { IssueAttachments } from "@ralphy/tracker";
import type { LogFn } from "./utils";
import {
  composeSpecSource,
  syncSpecAttachments,
  type AttachmentFormat,
  type SpecAttachmentMutations,
} from "./spec-attachments";

/** Per-change inputs a sink consumes on each sync (the same bag the
 *  comment-sync `syncTasks` hook already threads). */
export interface SpecSyncInput {
  issueId: string;
  /** Absolute path to `.ralph-state.json` for this change. */
  statePath: string;
  /** Absolute path to `openspec/changes/<name>` for this change. */
  changeDir: string;
  iteration: number;
  log: LogFn;
}

export interface SpecSink {
  /** Publish the change's spec content to the issue. Best-effort: failures
   *  are logged by the sink and never thrown into the loop. */
  sync(input: SpecSyncInput): Promise<void>;
}

/** Marker type carried by the comment-embedded spec. Distinct from
 *  `attachment` (the status-marker substitute) so the two sticky comments
 *  never collide on re-discovery. */
export const SPEC_COMMENT_TYPE: RalphyCommentType = "spec";

/** GitHub caps issue comments at 65536 chars; leave headroom for the title,
 *  marker, and truncation note. */
const MAX_SPEC_COMMENT_CHARS = 60_000;

/**
 * Adapt the tracker's {@link IssueAttachments} capability to the
 * {@link SpecAttachmentMutations} bag `syncSpecAttachments` consumes. The
 * `apiKey` parameters of the legacy shape are ignored — credentials live
 * inside the capability.
 */
export function attachmentMutationsFromCapability(
  attachments: IssueAttachments,
): SpecAttachmentMutations {
  return {
    uploadFileToLinear: async (_apiKey, input) => ({
      assetUrl: await attachments.uploadFile(input),
    }),
    createAttachmentForUrl: (_apiKey, input) =>
      attachments.attachUrl(input.issueId, input.url, input.title, input.subtitle),
    deleteAttachment: (_apiKey, attachmentId) => attachments.delete(attachmentId),
    findIssueAttachmentByTitle: (_apiKey, issueId, title) =>
      attachments.findByTitle(issueId, title),
  };
}

export interface AttachmentSpecSinkDeps {
  apiKey: string;
  mutations: SpecAttachmentMutations;
  formats?: AttachmentFormat[];
  sealedRevisionMode?: "append" | "replace";
}

/** The Linear-shaped sink: unchanged `syncSpecAttachments` behavior
 *  (attachment slots, hash skip, sealed revisions, legacy purge). */
export function createAttachmentSpecSink(deps: AttachmentSpecSinkDeps): SpecSink {
  return {
    sync: (input) =>
      syncSpecAttachments({
        apiKey: deps.apiKey,
        mutations: deps.mutations,
        ...(deps.formats !== undefined ? { formats: deps.formats } : {}),
        ...(deps.sealedRevisionMode !== undefined
          ? { sealedRevisionMode: deps.sealedRevisionMode }
          : {}),
        ...input,
      }),
  };
}

export interface CommentSpecSinkDeps {
  /** Marker-idempotent sticky upsert on the issue (the tracker primitive). */
  upsertStickyComment: (issueId: string, type: RalphyCommentType, body: string) => Promise<void>;
  /** Current body of the issue's sticky comment of `type`, or null. Used to
   *  re-read the published sha so unchanged content skips the write. */
  readStickyComment: (issueId: string, type: RalphyCommentType) => Promise<string | null>;
}

/**
 * The comment-embedded sink (GitHub): publish the composed spec (design.md +
 * tasks.md Implementation section) inside one sticky `spec` comment. The
 * comment's hidden marker records the content sha, so the skip decision is
 * stateless — re-read from the issue, never from local state — and survives a
 * wiped worktree.
 */
export function createCommentSpecSink(deps: CommentSpecSinkDeps): SpecSink {
  return {
    sync: async (input) => {
      const source = await composeSpecSource(input.changeDir, input.log);
      if (!source) return;

      let existing: string | null = null;
      try {
        existing = await deps.readStickyComment(input.issueId, SPEC_COMMENT_TYPE);
      } catch (err) {
        input.log(
          `! spec-sink: could not read existing spec comment (continuing): ${(err as Error).message}`,
          "yellow",
        );
      }
      if (existing && parseRalphyMarker(existing)?.fields.sha === source.hash) {
        input.log("  spec-sink: design spec unchanged, skipping", "gray");
        return;
      }

      let markdown = new TextDecoder().decode(source.sourceBytes);
      if (markdown.length > MAX_SPEC_COMMENT_CHARS) {
        markdown =
          markdown.slice(0, MAX_SPEC_COMMENT_CHARS) +
          "\n\n_… spec truncated to fit the comment size limit._";
      }

      const body = buildRalphyComment({
        type: SPEC_COMMENT_TYPE,
        action: "design spec",
        body: markdown,
        fields: { sha: source.hash, iteration: input.iteration },
      });
      try {
        await deps.upsertStickyComment(input.issueId, SPEC_COMMENT_TYPE, body);
      } catch (err) {
        input.log(`! spec-sink: spec comment upsert failed: ${(err as Error).message}`, "yellow");
        return;
      }
      input.log(`  spec-sink: design spec comment ${existing ? "updated" : "created"}`, "gray");
    },
  };
}
