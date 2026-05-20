import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { SetIndicator } from "@ralphy/types";

/** State slot persisted under `state.confirmation`. Mirrors the schema in
 *  `@ralphy/types`, but resolved to concrete fields with safe defaults so
 *  the agent layer can operate on a `null`-free shape. */
export interface ConfirmationState {
  askedAt: string | null;
  lastReminderAt: string | null;
  confirmedAt: string | null;
  rounds: number;
  /** Set once the round-cap stuck comment has been posted. Prevents
   *  re-posting on every poll. Not part of the durable schema — lives in
   *  state.json under `confirmation.stuckPostedAt` opportunistically. */
  stuckPostedAt?: string | null;
  /** Timestamp of the newest revise comment we've consumed. Comments older
   *  than (or equal to) this are ignored. Stored loosely in the state. */
  lastReviseConsumedAt?: string | null;
}

export function defaultConfirmation(): ConfirmationState {
  return {
    askedAt: null,
    lastReminderAt: null,
    confirmedAt: null,
    rounds: 0,
    stuckPostedAt: null,
    lastReviseConsumedAt: null,
  };
}

export async function readConfirmationState(statePath: string): Promise<{
  stateObj: Record<string, unknown>;
  confirmation: ConfirmationState;
}> {
  const f = Bun.file(statePath);
  let stateObj: Record<string, unknown> = {};
  if (await f.exists()) {
    try {
      stateObj = (await f.json()) as Record<string, unknown>;
    } catch {
      stateObj = {};
    }
  }
  const existing = (stateObj.confirmation ?? null) as Partial<ConfirmationState> | null;
  const confirmation: ConfirmationState = {
    askedAt: existing?.askedAt ?? null,
    lastReminderAt: existing?.lastReminderAt ?? null,
    confirmedAt: existing?.confirmedAt ?? null,
    rounds: existing?.rounds ?? 0,
    stuckPostedAt: existing?.stuckPostedAt ?? null,
    lastReviseConsumedAt: existing?.lastReviseConsumedAt ?? null,
  };
  return { stateObj, confirmation };
}

export async function writeConfirmationState(
  statePath: string,
  stateObj: Record<string, unknown>,
  confirmation: ConfirmationState,
): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await Bun.write(statePath, JSON.stringify({ ...stateObj, confirmation }, null, 2) + "\n");
}

/** Build a regex matching `<handle> revise: <reason>`. Case-insensitive. */
export function buildReviseRegex(handle: string): RegExp {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s+revise\\s*:\\s*([\\s\\S]+?)\\s*$`, "im");
}

export interface ReviseMatch {
  commentId: string;
  createdAt: string;
  reason: string;
}

/** Extract the newest revise comment from a list (created-at descending),
 *  ignoring anything created at-or-before `since`. */
export function findNewestRevise(
  comments: { id: string; body: string; createdAt: string }[],
  re: RegExp,
  since: string | null,
): ReviseMatch | null {
  const sorted = [...comments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const c of sorted) {
    if (since && c.createdAt <= since) break;
    const m = re.exec(c.body);
    if (m && m[1]) {
      return { commentId: c.id, createdAt: c.createdAt, reason: m[1].trim() };
    }
  }
  return null;
}

/** Re-stub `design.md` and delete `tasks.md` so the deriver returns to
 *  `design` on the next poll. The worker will rescaffold tasks.md when it
 *  iterates again. */
export async function restartFromDesign(changeDir: string, changeName: string): Promise<void> {
  const designStub = [
    `# Design for ${changeName}`,
    "",
    "_Fill in the technical design as you work through the issue._",
    "",
  ].join("\n");
  await Bun.write(join(changeDir, "design.md"), designStub);
  const tasksPath = join(changeDir, "tasks.md");
  if (await Bun.file(tasksPath).exists()) {
    // Truncate tasks.md to a stub so the deriver returns to the `tasks`
    // phase (no unchecked items present). The worker re-derives tasks
    // from the (now updated via steering) proposal/design.
    await Bun.write(tasksPath, "# Tasks\n\n_Regenerating after revise request._\n");
  }
}

/** Append a steering note to steering.md (newest first). */
export async function appendSteeringNote(changeDir: string, message: string): Promise<void> {
  const path = join(changeDir, "steering.md");
  const f = Bun.file(path);
  const existing = (await f.exists()) ? await f.text() : null;
  const updated = existing ? `${message}\n\n${existing.trimStart()}` : `${message}\n`;
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, updated);
}

/** Outcome of inspecting a single awaiting-confirmation ticket. */
export type InspectionOutcome = "stay-awaiting" | "approved" | "revised" | "stuck";

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

  // 1. Approval signal — fire clearApproved + persist confirmedAt.
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

  // 2. Revise comment — append to steering, bump rounds, loop back to design.
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
