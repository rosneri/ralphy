import { dirname, join } from "node:path";
import { readSlotSidecar, writeSlotField } from "@ralphy/core/state";
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
  };
}

/** Read the inline `confirmation` slot from the legacy core `.ralph-state.json`.
 *  Used once to migrate a change written before confirmation moved to its own
 *  sidecar; returns null when the file is missing/malformed or has no slot. */
async function readInlineConfirmation(
  statePath: string,
): Promise<Partial<ConfirmationState> | null> {
  const f = Bun.file(statePath);
  if (!(await f.exists())) return null;
  try {
    const obj = (await f.json()) as Record<string, unknown>;
    return (obj.confirmation ?? null) as Partial<ConfirmationState> | null;
  } catch {
    return null;
  }
}

/**
 * Read the confirmation slot. The authoritative copy lives in the
 * `.ralph-state.confirmation.json` sidecar (single-writer, no cross-process
 * clobber). Falls back to the inline core-file slot for changes written
 * before the sidecar split. `stateObj` is retained in the return shape for
 * call-site compatibility but is no longer used for writes.
 */
export async function readConfirmationState(statePath: string): Promise<{
  stateObj: Record<string, unknown>;
  confirmation: ConfirmationState;
}> {
  const changeDir = dirname(statePath);
  const sidecar = await readSlotSidecar(changeDir, "confirmation");
  const existing = (sidecar ??
    (await readInlineConfirmation(statePath)) ??
    null) as Partial<ConfirmationState> | null;
  const confirmation: ConfirmationState = {
    askedAt: existing?.askedAt ?? null,
    lastReminderAt: existing?.lastReminderAt ?? null,
    confirmedAt: existing?.confirmedAt ?? null,
    rounds: existing?.rounds ?? 0,
    stuckPostedAt: existing?.stuckPostedAt ?? null,
    lastReviseConsumedAt: existing?.lastReviseConsumedAt ?? null,
    awaitingMarkerAppliedAt: existing?.awaitingMarkerAppliedAt ?? null,
  };
  return { stateObj: {}, confirmation };
}

/**
 * Write the confirmation slot to its sidecar. The whole slot is written
 * atomically to `.ralph-state.confirmation.json`; the core `.ralph-state.json`
 * is never touched, so this can no longer clobber the loop's state. The
 * `stateObj` parameter is accepted for call-site compatibility and ignored.
 */
export async function writeConfirmationState(
  statePath: string,
  _stateObj: Record<string, unknown>,
  confirmation: ConfirmationState,
): Promise<void> {
  await writeSlotField(dirname(statePath), "confirmation", confirmation);
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
