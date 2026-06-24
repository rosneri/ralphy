import { projectLayout } from "@ralphy/core/layout";
import type { RalphyConfig } from "../config";
import {
  postOrUpdateTasksComment,
  postPlanCommentOnce,
  postSteeringAndRefreshTasks,
  type CommentMutations,
} from "../linear-sync/comment-sync";
import type { SpecAttachmentMutations } from "../linear-sync/spec-attachments";
import {
  createAttachmentSpecSink,
  createCommentSpecSink,
  type SpecSink,
} from "../linear-sync/spec-sink";
import {
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  uploadFileToLinear,
  createAttachmentForUrl,
  deleteAttachment,
  findIssueAttachmentByTitle,
} from "../../shared/capabilities/linear-client";
import type { CmdRunner } from "../pr";
import { readStickyComment, upsertStickyComment } from "./tracker/sticky-comment";
import type { TrackedIssue } from "@ralphy/tracker";

/** The Linear spec-attachment IO bag (module-level client functions). */
function defaultLinearSpecMutations(): SpecAttachmentMutations {
  return {
    uploadFileToLinear,
    createAttachmentForUrl,
    deleteAttachment,
    findIssueAttachmentByTitle,
  };
}

interface CommentSyncInput {
  apiKey: string;
  cfg: RalphyConfig;
  projectRoot: string;
  onLog: (text: string, color?: string) => void;
  /** File-only sink (mirrors the coordinator's `onFileLog`). Routed to the
   *  spec sinks so their unchanged-content skip lines — which recur every
   *  sync — land in the log file but not the agent view. */
  onFileLog?: (text: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  cwdByChange: Map<string, string>;
  issueByChange: Map<string, TrackedIssue>;
  /** Tracker-specific comment mutations. Defaults to the Linear trio. */
  commentMutations?: CommentMutations;
  /** Whether the backend credentials are ready. Defaults to `Boolean(apiKey)`. */
  credentialsReady?: boolean;
  /** Spec-content sink (RLF-239): how `syncSpecsAsAttachments` content reaches
   *  the issue. Defaults to the Linear attachment sink over the module-level
   *  Linear mutations; `null` disables spec publishing. The GitHub tracker
   *  passes the comment-embedded sink. */
  specSink?: SpecSink | null;
}

interface CommentSyncHooks {
  enabled: boolean;
  syncTasks?: (
    worker: { changeName: string; issueId: string; cwd?: string },
    iteration: number,
  ) => Promise<void>;
  onSteeringAppended?: (changeName: string, message: string) => Promise<void>;
}

export function createCommentSyncHooks(input: CommentSyncInput): CommentSyncHooks {
  const { apiKey, cfg, projectRoot, onLog, onFileLog, diag, cwdByChange, issueByChange } = input;
  // The tasks-comment mirror and the spec-attachment (proposal/design, incl.
  // PDF) upload are independent features that share one `syncTasks` hook.
  // Wire the hook when *either* is on — gating spec attachments behind
  // `syncTasksToComment` previously left `syncSpecsAsAttachments: true` dead
  // whenever the sticky comment was disabled (no design PDF on the issue).
  const credsReady = input.credentialsReady ?? Boolean(apiKey);
  const commentsEnabled = Boolean(cfg.linear.syncTasksToComment) && credsReady;
  // Default sink: the Linear attachment slots over the module-level Linear
  // mutations — the pre-seam behavior. An explicit `null` (a backend with no
  // way to publish specs) disables the feature outright.
  const specSink: SpecSink | null =
    input.specSink !== undefined
      ? input.specSink
      : createAttachmentSpecSink({
          apiKey,
          mutations: defaultLinearSpecMutations(),
          ...(cfg.linear.specAttachmentFormats !== undefined
            ? { formats: cfg.linear.specAttachmentFormats }
            : {}),
          ...(cfg.linear.specAttachmentRevisions !== undefined
            ? { sealedRevisionMode: cfg.linear.specAttachmentRevisions }
            : {}),
        });
  const specAttachmentsEnabled =
    specSink !== null && Boolean(cfg.linear.syncSpecsAsAttachments) && credsReady;
  const enabled = commentsEnabled || specAttachmentsEnabled;
  if (!enabled) return { enabled: false };

  const commentMutations: CommentMutations = input.commentMutations ?? {
    createIssueComment,
    updateIssueComment,
    deleteIssueComment,
  };

  return {
    enabled,
    syncTasks: async (worker, iteration) => {
      // Prefer the worker's own cwd: the coordinator's post-exit flushes
      // (awaiting-reap, done) run after the wire exit handler has already
      // cleared cwdByChange, so the map alone would silently fall back to
      // projectRoot — where worktree-only change files don't exist.
      const root = worker.cwd ?? cwdByChange.get(worker.changeName) ?? projectRoot;
      const layout = projectLayout(root);
      const changeDir = layout.changeDir(worker.changeName);
      const statePath = layout.stateFile(worker.changeName);
      if (commentsEnabled) {
        if (!specAttachmentsEnabled) {
          await postPlanCommentOnce({
            apiKey,
            issueId: worker.issueId,
            statePath,
            changeDir,
            changeName: worker.changeName,
            log: onLog,
            mutations: commentMutations,
          });
        }
        await postOrUpdateTasksComment({
          apiKey,
          issueId: worker.issueId,
          statePath,
          changeDir,
          changeName: worker.changeName,
          iteration,
          log: onLog,
          mutations: commentMutations,
        });
      }
      if (specAttachmentsEnabled && specSink) {
        await specSink.sync({
          issueId: worker.issueId,
          statePath,
          changeDir,
          iteration,
          log: onLog,
          ...(onFileLog ? { fileLog: onFileLog } : {}),
        });
      }
    },
    // Steering acknowledgement + tasks-comment refresh is part of the
    // tasks-comment mirror, so it only runs when that feature is on.
    ...(commentsEnabled
      ? {
          onSteeringAppended: async (changeName: string, message: string) => {
            const root = cwdByChange.get(changeName) ?? projectRoot;
            const layout = projectLayout(root);
            const changeDir = layout.changeDir(changeName);
            const statePath = layout.stateFile(changeName);
            const issue = issueByChange.get(changeName) ?? null;
            const issueId = issue?.id ?? null;
            if (!issueId) {
              diag(
                "comment-sync",
                `  comment-sync: no Linear issue cached for ${changeName}; skipping steering refresh`,
                "gray",
              );
              return;
            }
            let iteration = 0;
            try {
              const f = Bun.file(statePath);
              if (await f.exists()) {
                const json = (await f.json()) as { iteration?: number };
                iteration = json.iteration ?? 0;
              }
            } catch {
              /* ignore */
            }
            await postSteeringAndRefreshTasks({
              apiKey,
              issueId,
              statePath,
              changeDir,
              changeName,
              iteration,
              message,
              log: onLog,
              mutations: commentMutations,
            });
          },
        }
      : {}),
  };
}

/**
 * Build the GitHub comment-embedded {@link SpecSink} (RLF-239): the composed
 * spec content lives inside one marker-tagged sticky issue comment, upserted
 * and re-read through `gh`.
 */
export function createGithubCommentSpecSink(deps: {
  cmdRunner: CmdRunner;
  projectRoot: string;
  repo: () => Promise<string>;
  diag: (area: string, message: string, color?: string) => void;
}): SpecSink {
  return createCommentSpecSink({
    upsertStickyComment: async (issueId, type, body) =>
      upsertStickyComment({
        cmdRunner: deps.cmdRunner,
        repo: await deps.repo(),
        projectRoot: deps.projectRoot,
        issueNumber: issueId,
        type,
        body,
        diag: deps.diag,
      }),
    readStickyComment: async (issueId, type) =>
      readStickyComment({
        cmdRunner: deps.cmdRunner,
        repo: await deps.repo(),
        projectRoot: deps.projectRoot,
        issueNumber: issueId,
        type,
      }),
  });
}
