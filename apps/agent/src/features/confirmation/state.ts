import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { fsChange } from "../../shared/capabilities/fs-change";
import { runCapability } from "../../shared/capabilities/run-capability";

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
  /** Set when `setAwaitingConfirmation` has been applied for the current
   *  gate-entry. Guards against re-applying on every poll. Cleared back to
   *  null whenever the gate releases. */
  awaitingMarkerAppliedAt?: string | null;
  /** Set once the early draft PR has been opened for this change (prDraft
   *  mode — the PR is opened at the design-ready/park point so the design is
   *  reviewable in GitHub, then flipped to ready at the end of the run).
   *  Guards against re-opening on every poll. */
  earlyDraftPrAt?: string | null;
}

export function defaultConfirmation(): ConfirmationState {
  return {
    askedAt: null,
    lastReminderAt: null,
    confirmedAt: null,
    rounds: 0,
    stuckPostedAt: null,
    lastReviseConsumedAt: null,
    awaitingMarkerAppliedAt: null,
    earlyDraftPrAt: null,
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
    awaitingMarkerAppliedAt: existing?.awaitingMarkerAppliedAt ?? null,
    earlyDraftPrAt: existing?.earlyDraftPrAt ?? null,
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
  await runCapability(fsChange.appendSteering, { changeDir, message });
}
