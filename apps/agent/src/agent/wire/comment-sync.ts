import { projectLayout } from "@ralphy/core/layout";
import type { RalphyConfig } from "../config";
import {
  postOrUpdateTasksComment,
  postPlanCommentOnce,
  postSteeringAndRefreshTasks,
  type CommentMutations,
} from "../linear-sync/comment-sync";
import { syncSpecAttachments, type SpecAttachmentMutations } from "../linear-sync/spec-attachments";
import {
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  uploadFileToLinear,
  createAttachmentForUrl,
  deleteAttachment,
  findIssueAttachmentByTitle,
} from "../linear";
import type { TrackedIssue } from "@ralphy/tracker";

interface CommentSyncInput {
  apiKey: string;
  cfg: RalphyConfig;
  projectRoot: string;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  cwdByChange: Map<string, string>;
  issueByChange: Map<string, TrackedIssue>;
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
  const { apiKey, cfg, projectRoot, onLog, diag, cwdByChange, issueByChange } = input;
  // The tasks-comment mirror and the spec-attachment (proposal/design, incl.
  // PDF) upload are independent features that share one `syncTasks` hook.
  // Wire the hook when *either* is on — gating spec attachments behind
  // `syncTasksToComment` previously left `syncSpecsAsAttachments: true` dead
  // whenever the sticky comment was disabled (no design PDF on the issue).
  const commentsEnabled = Boolean(cfg.linear.syncTasksToComment && apiKey);
  const specAttachmentsEnabled = Boolean(cfg.linear.syncSpecsAsAttachments && apiKey);
  const enabled = commentsEnabled || specAttachmentsEnabled;
  if (!enabled) return { enabled: false };

  const commentMutations: CommentMutations = {
    createIssueComment,
    updateIssueComment,
    deleteIssueComment,
  };
  const specAttachmentMutations: SpecAttachmentMutations = {
    uploadFileToLinear,
    createAttachmentForUrl,
    deleteAttachment,
    findIssueAttachmentByTitle,
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
      if (specAttachmentsEnabled) {
        await syncSpecAttachments({
          apiKey,
          issueId: worker.issueId,
          statePath,
          changeDir,
          iteration,
          log: onLog,
          mutations: specAttachmentMutations,
          formats: cfg.linear.specAttachmentFormats,
          sealedRevisionMode: cfg.linear.specAttachmentRevisions,
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
