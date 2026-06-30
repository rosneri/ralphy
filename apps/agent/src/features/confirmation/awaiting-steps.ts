import { join } from "node:path";
import { buildRalphyComment } from "@ralphy/comms";
import { worktreeDirNameForIssue, worktreesDir } from "../../agent/worktree";
import { addIssueComment } from "../../shared/capabilities/linear-client/comments";
import type { TrackedIssue } from "@ralphy/tracker";
import type { RalphyConfig } from "../../agent/config";
import { markersOf } from "@ralphy/types";
import type { Indicators, SetIndicator } from "@ralphy/types";
import { describeApprovalMarker } from "@ralphy/workflow";
import { readConfirmationState, writeConfirmationState, type ConfirmationState } from "./state";

type LogFunction = (message: string, color?: string) => void;
type ApplyIndicator = (issue: TrackedIssue, indicator: SetIndicator) => Promise<void>;
type OpenDraftPr = (issue: TrackedIssue, changeName: string, cwd: string) => Promise<string | null>;

export async function resolveChangeCwdForIssue(
  issue: { identifier: string },
  changeName: string,
  deps: { projectRoot: string; useWorktree: boolean; cwdOf: (cn: string) => string | undefined },
): Promise<string> {
  const tracked = deps.cwdOf(changeName);
  if (tracked) return tracked;
  if (!deps.useWorktree) return deps.projectRoot;
  const root = worktreesDir(deps.projectRoot);
  const canonical = join(root, worktreeDirNameForIssue(issue));
  if (await Bun.file(join(canonical, "openspec", "changes", changeName, "tasks.md")).exists()) {
    return canonical;
  }
  const legacy = join(root, changeName);
  if (await Bun.file(join(legacy, "openspec", "changes", changeName, "tasks.md")).exists()) {
    return legacy;
  }
  return deps.projectRoot;
}

export async function readTextOrNull(path: string): Promise<string | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  try {
    return await f.text();
  } catch {
    return null;
  }
}

/** Post the one-shot "📋 Ralphy plan ready" Linear comment on the first
 *  poll that observes the ticket in the `awaiting-confirmation` phase. */
export async function postPlanReadyCommentOnce(
  issue: TrackedIssue,
  statePath: string,
  changeName: string,
  deps: { apiKey: string; cfg: RalphyConfig; onLog: LogFunction },
): Promise<void> {
  if (!deps.apiKey) return;
  if (deps.cfg.linear.postComments === false) return;
  const { confirmation } = await readConfirmationState(statePath);
  if (confirmation.askedAt) return;
  const approvalSentence = describeApprovalMarker(deps.cfg.linear.indicators.getApproved);
  const handle = deps.cfg.linear.mentionHandle;
  const body = buildRalphyComment({
    type: "plan-ready",
    action: "plan ready",
    body:
      `Plan ready for \`${changeName}\` — review proposal.md / design.md / tasks.md ` +
      `and ${approvalSentence} to continue, ` +
      `or reply with \`${handle} revise: <reason>\` to send it back to design.`,
    fields: { change: changeName },
  });
  try {
    await addIssueComment(deps.apiKey, issue.id, body);
  } catch (err) {
    deps.onLog(
      `! Linear plan-ready comment failed for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }
  try {
    await writeConfirmationState(
      statePath,
      {},
      { ...confirmation, askedAt: new Date().toISOString() },
    );
  } catch (err) {
    deps.onLog(
      `! could not persist confirmation.askedAt for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
  }
  deps.onLog(`  ${issue.identifier}: posted "📋 Ralphy plan ready" comment`, "gray");
}

/** Apply `setAwaitingConfirmation` once per gate-entry; stamp the state. */
export async function applyAwaitingMarkerOnce(
  issue: TrackedIssue,
  statePath: string,
  state: { stateObj: Record<string, unknown>; confirmation: ConfirmationState },
  deps: {
    indicators: Indicators;
    applyIndicator: ApplyIndicator;
    onLog: LogFunction;
  },
): Promise<void> {
  if (!deps.indicators.setAwaitingConfirmation) return;
  if (state.confirmation.awaitingMarkerAppliedAt) return;
  try {
    await deps.applyIndicator(issue, deps.indicators.setAwaitingConfirmation);
  } catch (err) {
    deps.onLog(
      `! setAwaitingConfirmation failed for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }
  state.confirmation.awaitingMarkerAppliedAt = new Date().toISOString();
  try {
    // Re-read before writing: another step in this same poll (e.g. the
    // plan-ready comment) may have persisted its own stamp since `state`
    // was captured — writing the captured object back would erase it.
    const fresh = await readConfirmationState(statePath);
    fresh.confirmation.awaitingMarkerAppliedAt = state.confirmation.awaitingMarkerAppliedAt;
    await writeConfirmationState(statePath, fresh.stateObj, fresh.confirmation);
  } catch (err) {
    deps.onLog(
      `! persist awaitingMarkerAppliedAt for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
  }
}

/** Open the early draft PR once per gate-entry (prDraft mode). The PR is opened
 *  at the design-ready/park point — carrying just the committed design so it is
 *  reviewable in GitHub while implementation streams in — and flipped from draft
 *  to ready at the end of the run by the post-task PR phase. No-op unless
 *  `cfg.prDraft` is set and an `openDraftPr` dep is wired. Best-effort: a null
 *  result (nothing to PR yet) or a failure leaves the stamp set so we don't
 *  retry every poll; the end-of-run PR phase still opens/readies the PR. */
export async function openDraftPrOnce(
  issue: TrackedIssue,
  statePath: string,
  changeName: string,
  cwd: string,
  state: { stateObj: Record<string, unknown>; confirmation: ConfirmationState },
  deps: {
    cfg: RalphyConfig;
    openDraftPr?: OpenDraftPr | undefined;
    onLog: LogFunction;
  },
): Promise<void> {
  if (deps.cfg.prDraft !== true) return;
  if (!deps.openDraftPr) return;
  if (state.confirmation.earlyDraftPrAt) return;
  let url: string | null = null;
  try {
    url = await deps.openDraftPr(issue, changeName, cwd);
  } catch (err) {
    deps.onLog(
      `! early draft PR open failed for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
  }
  state.confirmation.earlyDraftPrAt = new Date().toISOString();
  try {
    // Re-read before writing: `state` was captured before the plan-ready
    // comment persisted `askedAt` in this same poll — writing the captured
    // object back here erased that stamp and made the next poll post the
    // identical plan-ready comment again (lost-update; LIT-387 double post).
    const fresh = await readConfirmationState(statePath);
    fresh.confirmation.earlyDraftPrAt = state.confirmation.earlyDraftPrAt;
    await writeConfirmationState(statePath, fresh.stateObj, fresh.confirmation);
  } catch (err) {
    deps.onLog(
      `! persist earlyDraftPrAt for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
  }
  if (url) deps.onLog(`  ${issue.identifier}: opened draft PR for design — ${url}`, "gray");
}

/** True when the issue's current Linear status matches a `status`-type marker
 *  in `setAwaitingConfirmation` — i.e. the ticket is *observably* parked in the
 *  awaiting status right now, regardless of whether this process recorded the
 *  `awaitingMarkerAppliedAt` watermark. Used so the gate release can re-assert
 *  In Progress after an agent restart, when the park was stamped in a prior
 *  process. Label/comment/project awaiting markers are intentionally excluded:
 *  only a status park strands the ticket, and only `setInProgress` (a status)
 *  can undo it. */
function issueInAwaitingStatus(issue: TrackedIssue, indicators: Indicators): boolean {
  const set = indicators.setAwaitingConfirmation;
  if (!set) return false;
  const current = issue.state?.name;
  if (!current) return false;
  return markersOf(set).some((m) => m.type === "status" && m.value === current);
}

/** Apply `clearAwaitingConfirmation` if configured and the stamp is set;
 *  always null the stamp afterward (defence in depth — mirrors clearApproved).
 *
 *  When `setAwaitingConfirmation` is a *status* marker (e.g. a "Design Review"
 *  status), `clearAwaitingConfirmation` cannot undo it — the schema only allows
 *  label removal there, and the resume path skips `setInProgress` for
 *  `trigger === "resume"`. So once a ticket has actually been parked
 *  (`awaitingMarkerAppliedAt` set), re-assert `setInProgress` here so the ticket
 *  returns to In Progress when the gate releases (approved / revised / timeout)
 *  instead of stranding in the awaiting status while implementation runs. When
 *  the awaiting marker was a label and status was already In Progress this is a
 *  harmless no-op. */
/** Release the awaiting-confirmation marker (pull the ticket back to
 *  in-progress). Returns true when it actually transitioned the ticket, false
 *  when there was nothing to release (already cleared) — callers use this to log
 *  the release exactly once instead of on every poll. */
export async function releaseAwaitingMarker(
  issue: TrackedIssue,
  statePath: string,
  deps: {
    indicators: Indicators;
    applyIndicator: ApplyIndicator;
    onLog: LogFunction;
  },
): Promise<boolean> {
  const { stateObj, confirmation } = await readConfirmationState(statePath);
  // Normally the local `awaitingMarkerAppliedAt` watermark tells us the ticket
  // was parked and needs restoring. But that stamp is per-process: if the park
  // happened in a *previous* run (agent restart between parking and approval),
  // this process has no stamp even though the ticket is visibly sitting in the
  // awaiting status on Linear. Fall back to the issue's current status so the
  // gate release still pulls it back to In Progress instead of stranding it.
  if (!confirmation.awaitingMarkerAppliedAt && !issueInAwaitingStatus(issue, deps.indicators)) {
    return false;
  }
  if (deps.indicators.clearAwaitingConfirmation) {
    try {
      await deps.applyIndicator(issue, deps.indicators.clearAwaitingConfirmation);
    } catch (err) {
      deps.onLog(
        `! clearAwaitingConfirmation failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }
  if (deps.indicators.setInProgress) {
    try {
      await deps.applyIndicator(issue, deps.indicators.setInProgress);
    } catch (err) {
      deps.onLog(
        `! restore setInProgress after awaiting release failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }
  confirmation.awaitingMarkerAppliedAt = null;
  try {
    await writeConfirmationState(statePath, stateObj, confirmation);
  } catch (err) {
    deps.onLog(
      `! persist cleared awaitingMarkerAppliedAt for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
  }
  return true;
}

/** True when any confirmation indicator (`getApproved` / `getConfirmGate`) is a
 *  `comment`-type marker. Only then must we fetch the issue's comments to
 *  evaluate the gate — label/status/project indicators read straight off the
 *  issue, so the comments round-trip is skipped otherwise. */
export function confirmationUsesCommentIndicator(cfg: RalphyConfig): boolean {
  const { getApproved, getConfirmGate } = cfg.linear.indicators;
  return [getApproved, getConfirmGate].some((g) => g?.filter.some((m) => m.type === "comment"));
}
