import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { projectLayout } from "@ralphy/core/layout";
import { gateActive, hasUnchecked, planningComplete } from "@ralphy/core/detections";
import { isStubArtifact } from "@ralphy/core/openspec-phase";
import { worktreeDirNameForIssue, worktreesDir } from "../../agent/worktree";
import { changeNameForIssue } from "../../agent/scaffold";
import { addIssueComment, addReactionToComment, fetchIssueComments } from "../../agent/linear";
import { isRalphComment } from "../../shared/utils/ralph-comment";
import type { LinearIssue } from "../../agent/linear";
import type { RalphyConfig } from "../../agent/config";
import { markersOf } from "@ralphy/types";
import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import {
  computeConfirmationFlags,
  describeApprovalMarker,
  type ConfirmationTicketView,
} from "@ralphy/workflow";
import {
  appendSteeringNote,
  readConfirmationState,
  restartFromDesign as restartFromDesignFs,
  writeConfirmationState,
  type ConfirmationState,
} from "./state";
import { inspectAwaitingTicket } from "./inspect";

interface AwaitingDeps {
  cfg: RalphyConfig;
  apiKey: string;
  projectRoot: string;
  useWorktree: boolean;
  indicators: Indicators;
  cwdOf: (changeName: string) => string | undefined;
  awaitingChangeSet: Set<string>;
  reapForAwaiting: (changeName: string) => void;
  applyIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  applyMarker: (issue: LinearIssue, m: Marker) => Promise<void>;
  onAwaitingTicket?: (info: {
    changeName: string;
    issueIdentifier: string;
    issueUrl: string;
    issueTitle: string;
    since: string | null;
    round: number;
  }) => void;
  onLog: (msg: string, color?: string) => void;
}

async function resolveChangeCwdForIssue(
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

async function readTextOrNull(path: string): Promise<string | null> {
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
async function postPlanReadyCommentOnce(
  issue: LinearIssue,
  statePath: string,
  changeName: string,
  deps: { apiKey: string; cfg: RalphyConfig; onLog: AwaitingDeps["onLog"] },
): Promise<void> {
  if (!deps.apiKey) return;
  if (deps.cfg.linear.postComments === false) return;
  let stateObj: Record<string, unknown> = {};
  const f = Bun.file(statePath);
  if (await f.exists()) {
    try {
      stateObj = (await f.json()) as Record<string, unknown>;
    } catch {
      stateObj = {};
    }
  }
  const confirmation =
    (stateObj.confirmation as {
      askedAt?: string | null;
      lastReminderAt?: string | null;
      confirmedAt?: string | null;
      rounds?: number;
    } | null) ?? null;
  if (confirmation?.askedAt) return;
  const approvalSentence = describeApprovalMarker(deps.cfg.linear.indicators.getApproved);
  const handle = deps.cfg.linear.mentionHandle;
  const body =
    `📋 Ralphy plan ready for \`${changeName}\` — review proposal.md / design.md / tasks.md ` +
    `and ${approvalSentence} to continue, ` +
    `or reply with \`${handle} revise: <reason>\` to send it back to design.`;
  try {
    await addIssueComment(deps.apiKey, issue.id, body);
  } catch (err) {
    deps.onLog(
      `! Linear plan-ready comment failed for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }
  const nextConfirmation = {
    askedAt: new Date().toISOString(),
    lastReminderAt: confirmation?.lastReminderAt ?? null,
    confirmedAt: confirmation?.confirmedAt ?? null,
    rounds: confirmation?.rounds ?? 0,
  };
  try {
    await mkdir(dirname(statePath), { recursive: true });
    await Bun.write(
      statePath,
      JSON.stringify({ ...stateObj, confirmation: nextConfirmation }, null, 2) + "\n",
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
async function applyAwaitingMarkerOnce(
  issue: LinearIssue,
  statePath: string,
  state: { stateObj: Record<string, unknown>; confirmation: ConfirmationState },
  deps: {
    indicators: Indicators;
    applyIndicator: AwaitingDeps["applyIndicator"];
    onLog: AwaitingDeps["onLog"];
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
    await writeConfirmationState(statePath, state.stateObj, state.confirmation);
  } catch (err) {
    deps.onLog(
      `! persist awaitingMarkerAppliedAt for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
  }
}

/** True when the issue's current Linear status matches a `status`-type marker
 *  in `setAwaitingConfirmation` — i.e. the ticket is *observably* parked in the
 *  awaiting status right now, regardless of whether this process recorded the
 *  `awaitingMarkerAppliedAt` watermark. Used so the gate release can re-assert
 *  In Progress after an agent restart, when the park was stamped in a prior
 *  process. Label/comment/project awaiting markers are intentionally excluded:
 *  only a status park strands the ticket, and only `setInProgress` (a status)
 *  can undo it. */
function issueInAwaitingStatus(issue: LinearIssue, indicators: Indicators): boolean {
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
async function releaseAwaitingMarker(
  issue: LinearIssue,
  statePath: string,
  deps: {
    indicators: Indicators;
    applyIndicator: AwaitingDeps["applyIndicator"];
    onLog: AwaitingDeps["onLog"];
  },
): Promise<void> {
  const { stateObj, confirmation } = await readConfirmationState(statePath);
  // Normally the local `awaitingMarkerAppliedAt` watermark tells us the ticket
  // was parked and needs restoring. But that stamp is per-process: if the park
  // happened in a *previous* run (agent restart between parking and approval),
  // this process has no stamp even though the ticket is visibly sitting in the
  // awaiting status on Linear. Fall back to the issue's current status so the
  // gate release still pulls it back to In Progress instead of stranding it.
  if (!confirmation.awaitingMarkerAppliedAt && !issueInAwaitingStatus(issue, deps.indicators)) {
    return;
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
}

/** True when any confirmation indicator (`getApproved` / `getAutoApprove` /
 *  `getConfirmGate`) is a `comment`-type marker. Only then must we fetch the
 *  issue's comments to evaluate the gate — label/status/project indicators read
 *  straight off the issue, so the comments round-trip is skipped otherwise. */
function confirmationUsesCommentIndicator(cfg: RalphyConfig): boolean {
  const { getApproved, getAutoApprove, getConfirmGate } = cfg.linear.indicators;
  return [getApproved, getAutoApprove, getConfirmGate].some((g) =>
    g?.filter.some((m) => m.type === "comment"),
  );
}

/**
 * Per in-progress issue, derive the OpenSpec phase against the change
 * directory on disk and the workflow's confirmation-mode config.
 */
export async function processAwaitingForIssue(
  issue: LinearIssue,
  deps: AwaitingDeps,
): Promise<boolean> {
  try {
    const { cfg, apiKey, indicators } = deps;
    if (!cfg.linear.confirmationMode.enabled) {
      deps.onLog(`  ${issue.identifier}: confirmation detect released — disabled`);
      return false;
    }
    const cm = cfg.linear.confirmationMode;
    const changeName = changeNameForIssue(issue);
    const cwd = await resolveChangeCwdForIssue(issue, changeName, {
      projectRoot: deps.projectRoot,
      useWorktree: deps.useWorktree,
      cwdOf: deps.cwdOf,
    });
    const layout = projectLayout(cwd);
    const changeDir = layout.changeDir(changeName);
    const statePath = layout.stateFile(changeName);
    const tasks = await readTextOrNull(join(changeDir, "tasks.md"));
    const proposal = await readTextOrNull(join(changeDir, "proposal.md"));
    const design = await readTextOrNull(join(changeDir, "design.md"));
    // Fetch the issue's comments at most once per poll, shared between the
    // approve-by-comment gate check below and `inspectAwaitingTicket`'s revise
    // detection further down.
    let commentsCache: { id: string; body: string; createdAt: string }[] | null = null;
    const getComments = async () => {
      if (commentsCache) return commentsCache;
      if (!apiKey) return (commentsCache = []);
      try {
        const cs = await fetchIssueComments(apiKey, issue.id);
        commentsCache = cs.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt }));
      } catch {
        commentsCache = [];
      }
      return commentsCache;
    };
    // A `comment`-type getApproved/getAutoApprove/getConfirmGate matches against
    // human (non-Ralph) comment bodies — populate them so the gate can clear on
    // an approval comment. Skipped entirely when no comment indicator is set.
    const commentBodies = confirmationUsesCommentIndicator(cfg)
      ? (await getComments()).filter((c) => !isRalphComment(c.body)).map((c) => c.body)
      : undefined;
    const ticketView: ConfirmationTicketView = {
      labels: issue.labels,
      state: issue.state,
      project: issue.project,
      ...(commentBodies ? { commentBodies } : {}),
    };
    const { approved: approvalMatches, confirmationGated } = computeConfirmationFlags(
      cfg,
      ticketView,
    );
    const { stateObj, confirmation } = await readConfirmationState(statePath);
    if (approvalMatches && confirmation.confirmedAt === null) {
      confirmation.confirmedAt = new Date().toISOString();
      try {
        await writeConfirmationState(statePath, stateObj, confirmation);
      } catch (err) {
        deps.onLog(
          `! persist confirmedAt failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    // Gate is inactive when: indicators bypass it (getAutoApprove/getConfirmGate), or
    // confirmedAt was persisted (approval watermark), or confirmationMode was disabled.
    const active =
      confirmationGated &&
      gateActive({
        config: { confirmationMode: cfg.linear.confirmationMode },
        persistedConfirmation: confirmation,
      });
    if (!active) {
      deps.awaitingChangeSet.delete(changeName);
      await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      deps.onLog(`  ${issue.identifier}: confirmation detect released — gate-cleared`);
      return false;
    }
    if (!hasUnchecked(tasks ?? "")) {
      deps.awaitingChangeSet.delete(changeName);
      await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      deps.onLog(`  ${issue.identifier}: confirmation detect released — tasks-empty`);
      return false;
    }
    if (!planningComplete(tasks ?? "")) {
      deps.awaitingChangeSet.delete(changeName);
      await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      deps.onLog(`  ${issue.identifier}: confirmation detect released — planning-incomplete`);
      return false;
    }
    if (isStubArtifact(proposal) || isStubArtifact(design)) {
      deps.awaitingChangeSet.delete(changeName);
      await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      deps.onLog(
        `  ${issue.identifier}: confirmation detect released — proposal/design not yet filled in`,
      );
      return false;
    }
    deps.awaitingChangeSet.add(changeName);
    deps.reapForAwaiting(changeName);
    await applyAwaitingMarkerOnce(
      issue,
      statePath,
      { stateObj, confirmation },
      { indicators, applyIndicator: deps.applyIndicator, onLog: deps.onLog },
    );
    await postPlanReadyCommentOnce(issue, statePath, changeName, {
      apiKey,
      cfg,
      onLog: deps.onLog,
    });
    const { stateObj: state2, confirmation: confirmation2 } =
      await readConfirmationState(statePath);
    const { outcome, next } = await inspectAwaitingTicket(
      confirmation2,
      {
        mentionHandle: cfg.linear.mentionHandle,
        timeoutHours: cm.timeoutHours,
        maxConfirmationRounds: cm.maxConfirmationRounds,
        postComments: cfg.linear.postComments !== false && Boolean(apiKey),
      },
      {
        approvalMatches,
        fetchComments: getComments,
        ...(indicators.clearApproved ? { clearApproved: indicators.clearApproved } : {}),
        applyIndicator: (ind) => deps.applyIndicator(issue, ind),
        postComment: async (body) => {
          if (!apiKey) return;
          await addIssueComment(apiKey, issue.id, body);
        },
        reactToComment: async (commentId, emoji) => {
          if (!apiKey) return;
          await addReactionToComment(apiKey, commentId, emoji);
        },
        applyStuckLabel: async () => {
          await deps.applyMarker(issue, { type: "label", value: "ralph:stuck" });
        },
        appendSteering: (msg) => appendSteeringNote(changeDir, msg),
        restartFromDesign: () => restartFromDesignFs(changeDir, changeName),
        log: deps.onLog,
      },
    );
    try {
      await writeConfirmationState(statePath, state2, next);
    } catch (err) {
      deps.onLog(
        `! persist confirmation state failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
    if (outcome === "approved") {
      deps.awaitingChangeSet.delete(changeName);
      await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      deps.onLog(`  ${issue.identifier}: confirmation detect released — outcome=approved`);
      return false;
    }
    if (outcome === "revised") {
      deps.awaitingChangeSet.delete(changeName);
      await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      deps.onLog(`  ${issue.identifier}: confirmation detect released — outcome=revised`);
      return false;
    }
    deps.onAwaitingTicket?.({
      changeName,
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
      issueTitle: issue.title,
      since: next.askedAt,
      round: next.rounds,
    });
    return true;
  } catch (err) {
    deps.onLog(
      `! confirmation detect threw for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
    return true;
  }
}
