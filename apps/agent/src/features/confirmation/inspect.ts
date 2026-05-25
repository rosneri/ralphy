import type { SetIndicator } from "@ralphy/types";
import type { ConfirmationState } from "./state";

/** Build a regex matching `<handle> revise: <reason>`. Case-insensitive. */
function buildReviseRegex(handle: string): RegExp {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s+revise\\s*:\\s*([\\s\\S]+?)\\s*$`, "im");
}

interface ReviseMatch {
  commentId: string;
  createdAt: string;
  reason: string;
}

/** Strip fenced code blocks and inline code spans from a markdown body so
 *  illustrative examples (e.g. the `@ralphy revise: <reason>` shown in our
 *  own "plan ready" comment) don't get matched as real commands. */
function stripCodeMarkup(body: string): string {
  return body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

/** Extract the newest revise comment from a list (created-at descending),
 *  ignoring anything created at-or-before `since`. */
function findNewestRevise(
  comments: { id: string; body: string; createdAt: string }[],
  re: RegExp,
  since: string | null,
): ReviseMatch | null {
  const sorted = [...comments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const c of sorted) {
    if (since && c.createdAt <= since) break;
    const m = re.exec(stripCodeMarkup(c.body));
    if (m && m[1]) {
      return { commentId: c.id, createdAt: c.createdAt, reason: m[1].trim() };
    }
  }
  return null;
}

/** Outcome of inspecting a single awaiting-confirmation ticket. */
type InspectionOutcome = "stay-awaiting" | "approved" | "revised" | "stuck";

export interface AwaitingInspectionDeps {
  /** True when `getApproved` matches the ticket. */
  approvalMatches: boolean;
  /** Recent comments on the ticket, newest first (or any order — we sort). */
  fetchComments: () => Promise<{ id: string; body: string; createdAt: string }[]>;
  /** Apply / remove indicators. */
  clearApproved?: SetIndicator | undefined;
  applyIndicator: (ind: SetIndicator) => Promise<void>;
  /** Post a Linear comment. Honours `postComments` toggle in caller. */
  postComment: (body: string) => Promise<void>;
  /** React to a Linear comment (👀) — used to mark a revise as consumed.
   *  Best-effort; failures are ignored by the caller. */
  reactToComment?: (commentId: string, emoji: string) => Promise<void>;
  /** Apply the `ralph:stuck` label when the round cap is hit. */
  applyStuckLabel?: () => Promise<void>;
  /** Append a steering note to the change. */
  appendSteering: (message: string) => Promise<void>;
  /** Re-stub design.md / tasks.md to loop back to design. */
  restartFromDesign: () => Promise<void>;
  /** Logger. */
  log: (line: string, color?: string) => void;
}

export interface AwaitingInspectionConfig {
  /** `@ralphy` mention handle. */
  mentionHandle: string;
  /** Reminder cadence in hours. */
  timeoutHours: number;
  /** Maximum revise rounds before marking stuck. */
  maxConfirmationRounds: number;
  /** Comment-posting toggle. */
  postComments: boolean;
  /** Wall-clock now (injectable for tests). */
  now?: () => Date;
}

/**
 * Inspect a single awaiting-confirmation ticket for human signals.
 *
 * Returns the outcome and the (possibly mutated) `ConfirmationState` the
 * caller should persist back to `.ralph-state.json`. The caller is
 * responsible for writing.
 */
export async function inspectAwaitingTicket(
  state: ConfirmationState,
  cfg: AwaitingInspectionConfig,
  deps: AwaitingInspectionDeps,
): Promise<{ outcome: InspectionOutcome; next: ConfirmationState }> {
  const now = (cfg.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const next: ConfirmationState = { ...state };

  // Round-cap guard. If we've already posted the stuck comment, this is a
  // no-op — caller still keeps the ticket in `awaiting`.
  if (next.rounds >= cfg.maxConfirmationRounds) {
    if (!next.stuckPostedAt) {
      if (cfg.postComments) {
        try {
          await deps.postComment(
            `⚠ Ralphy: confirmation gate stuck after ${next.rounds} revise round(s) ` +
              `(max ${cfg.maxConfirmationRounds}). Applying \`ralph:stuck\` — ` +
              `clear the label to retry, or apply the approval marker to proceed.`,
          );
        } catch (err) {
          deps.log(`! plan-stuck comment failed: ${(err as Error).message}`, "yellow");
        }
      }
      if (deps.applyStuckLabel) {
        try {
          await deps.applyStuckLabel();
        } catch (err) {
          deps.log(`! ralph:stuck label apply failed: ${(err as Error).message}`, "yellow");
        }
      }
      next.stuckPostedAt = nowIso;
    }
    return { outcome: "stuck", next };
  }

  // 1. Revise comment — checked FIRST so it wins over a simultaneously-present
  //    approval label (label race: apply → remove → apply with revise in between).
  const reviseRe = buildReviseRegex(cfg.mentionHandle);
  let comments: { id: string; body: string; createdAt: string }[] = [];
  try {
    comments = await deps.fetchComments();
  } catch (err) {
    deps.log(`! fetchComments failed: ${(err as Error).message}`, "yellow");
  }
  const watermark = state.lastReviseConsumedAt ?? state.askedAt ?? null;
  const revise = findNewestRevise(comments, reviseRe, watermark);
  if (revise) {
    try {
      await deps.appendSteering(
        `Reviewer revise request (round ${next.rounds + 1}, ${revise.createdAt}):\n\n${revise.reason}`,
      );
    } catch (err) {
      deps.log(`! appendSteering failed: ${(err as Error).message}`, "yellow");
    }
    try {
      await deps.restartFromDesign();
    } catch (err) {
      deps.log(`! restartFromDesign failed: ${(err as Error).message}`, "yellow");
    }
    if (deps.reactToComment) {
      try {
        await deps.reactToComment(revise.commentId, "👀");
      } catch {
        /* non-fatal */
      }
    }
    if (cfg.postComments) {
      try {
        await deps.postComment(
          `🔁 Ralphy: revise request acknowledged — restarting at design (round ${next.rounds + 1}/${cfg.maxConfirmationRounds}).`,
        );
      } catch (err) {
        deps.log(`! revise ack comment failed: ${(err as Error).message}`, "yellow");
      }
    }
    next.rounds += 1;
    next.confirmedAt = null;
    next.askedAt = null;
    next.lastReminderAt = null;
    next.lastReviseConsumedAt = revise.createdAt;
    return { outcome: "revised", next };
  }

  // 2. Approval signal — only reached when no unconsumed revise comment exists.
  if (deps.approvalMatches) {
    if (deps.clearApproved) {
      try {
        await deps.applyIndicator(deps.clearApproved);
      } catch (err) {
        deps.log(`! clearApproved failed: ${(err as Error).message}`, "yellow");
      }
    }
    next.confirmedAt = nowIso;
    return { outcome: "approved", next };
  }

  // 3. Reminder cadence.
  if (state.askedAt) {
    const ref = state.lastReminderAt ?? state.askedAt;
    const elapsedMs = now.getTime() - new Date(ref).getTime();
    const limitMs = cfg.timeoutHours * 60 * 60 * 1000;
    if (elapsedMs >= limitMs && cfg.postComments) {
      try {
        await deps.postComment(
          `⏰ Ralphy: still awaiting confirmation on this plan (round ${next.rounds + 1}/${cfg.maxConfirmationRounds}). ` +
            `Approve to continue or reply \`${cfg.mentionHandle} revise: <reason>\` to send it back.`,
        );
        next.lastReminderAt = nowIso;
      } catch (err) {
        deps.log(`! reminder comment failed: ${(err as Error).message}`, "yellow");
      }
    }
  }

  return { outcome: "stay-awaiting", next };
}
