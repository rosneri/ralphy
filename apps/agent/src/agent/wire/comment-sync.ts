import { projectLayout } from "@ralphy/core/layout";
import type { RalphyConfig } from "../config";
import {
  postOrUpdateTasksComment,
  postPlanCommentOnce,
  postSteeringAndRefreshTasks,
  type CommentMutations,
} from "../linear-sync/comment-sync";
import type { SpecSink } from "../linear-sync/spec-sink";
import {
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  type LinearIssue,
} from "../linear";

interface CommentSyncInput {
  apiKey: string;
  cfg: RalphyConfig;
  projectRoot: string;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  cwdByChange: Map<string, string>;
  issueByChange: Map<string, LinearIssue>;
  /** Backend-neutral design-doc publisher (Linear attachment / GitHub comment),
   *  selected by `tracker.kind` in `wire.ts`. `null` disables spec sync. */
  specSink: SpecSink | null;
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
  const { apiKey, cfg, projectRoot, onLog, diag, cwdByChange, issueByChange, specSink } = input;
  // The tasks-comment mirror and the spec-doc publish (Linear attachment /
  // GitHub comment) are independent features that share one `syncTasks` hook.
  // Wire the hook when *either* is on — gating the spec doc behind
  // `syncTasksToComment` previously left `syncSpecsAsAttachments: true` dead
  // whenever the sticky comment was disabled (no design doc on the issue).
  const commentsEnabled = Boolean(cfg.linear.syncTasksToComment && apiKey);
  // Spec sync runs when the flag is on AND a backend sink was selected. The
  // sink presence encodes backend availability — the Linear sink is built only
  // when an apiKey exists, the GitHub sink only in github mode.
  const specEnabled = Boolean(cfg.linear.syncSpecsAsAttachments && specSink);
  const enabled = commentsEnabled || specEnabled;
  if (!enabled) return { enabled: false };

  const commentMutations: CommentMutations = {
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
        if (!specEnabled) {
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
      if (specEnabled && specSink) {
        await specSink.sync({
          issueId: worker.issueId,
          statePath,
          changeDir,
          iteration,
          log: onLog,
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
