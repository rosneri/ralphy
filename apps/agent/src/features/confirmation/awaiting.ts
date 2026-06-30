import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import { gateActive, hasUnchecked, planningComplete } from "@ralphy/core/detections";
import { isStubArtifact } from "@ralphy/core/openspec-phase";
import { changeNameForIssue } from "../../agent/scaffold";
import {
  addIssueComment,
  addReactionToComment,
  fetchIssueComments,
} from "../../shared/capabilities/linear-client/comments";
import { isRalphComment } from "../../shared/utils/ralph-comment";
import type { TrackedIssue } from "@ralphy/tracker";
import type { RalphyConfig } from "../../agent/config";
import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import { computeConfirmationFlags, type ConfirmationTicketView } from "@ralphy/workflow";
import {
  appendSteeringNote,
  readConfirmationState,
  restartFromDesign as restartFromDesignFs,
  writeConfirmationState,
} from "./state";
import { inspectAwaitingTicket } from "./inspect";
import {
  applyAwaitingMarkerOnce,
  confirmationUsesCommentIndicator,
  openDraftPrOnce,
  postPlanReadyCommentOnce,
  readTextOrNull,
  releaseAwaitingMarker,
  resolveChangeCwdForIssue,
} from "./awaiting-steps";

interface AwaitingDeps {
  cfg: RalphyConfig;
  apiKey: string;
  projectRoot: string;
  useWorktree: boolean;
  indicators: Indicators;
  cwdOf: (changeName: string) => string | undefined;
  awaitingChangeSet: Set<string>;
  reapForAwaiting: (changeName: string) => void;
  applyIndicator: (issue: TrackedIssue, ind: SetIndicator) => Promise<void>;
  applyMarker: (issue: TrackedIssue, m: Marker) => Promise<void>;
  /** Opens the early draft PR for the design once the gate parks the ticket
   *  (prDraft mode). Returns the PR URL, or null when there is nothing to PR
   *  yet (e.g. the design isn't committed). Omitted ⇒ no early PR is opened
   *  and the PR is created at the end of the run as usual. */
  openDraftPr?: (issue: TrackedIssue, changeName: string, cwd: string) => Promise<string | null>;
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

/**
 * Per in-progress issue, derive the OpenSpec phase against the change
 * directory on disk and the workflow's confirmation-mode config.
 */
export async function processAwaitingForIssue(
  issue: TrackedIssue,
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
    // A `comment`-type getApproved/getConfirmGate matches against
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
    // Gate is inactive when: the opt-in (getConfirmGate) excludes it, or
    // confirmedAt was persisted (approval watermark), or confirmationMode was disabled.
    const active =
      confirmationGated &&
      gateActive({
        config: { confirmationMode: cfg.linear.confirmationMode },
        persistedConfirmation: confirmation,
      });
    if (!active) {
      // gate-cleared is a one-time park→release transition (the gate was
      // satisfied, e.g. approval landed). Log only when the ticket was actually
      // parked — tracked in-process, or its marker cleared on Linear — otherwise
      // a confirmed ticket resting in-review re-logs the release every poll.
      const wasTracked = deps.awaitingChangeSet.delete(changeName);
      const released = await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      if (wasTracked || released) {
        deps.onLog(`  ${issue.identifier}: confirmation detect released — gate-cleared`);
      }
      return false;
    }
    if (!hasUnchecked(tasks ?? "")) {
      const wasTracked = deps.awaitingChangeSet.delete(changeName);
      const released = await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      if (wasTracked || released) {
        deps.onLog(`  ${issue.identifier}: confirmation detect released — tasks-empty`);
      }
      return false;
    }
    if (!planningComplete(tasks ?? "")) {
      const wasTracked = deps.awaitingChangeSet.delete(changeName);
      const released = await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      if (wasTracked || released) {
        deps.onLog(`  ${issue.identifier}: confirmation detect released — planning-incomplete`);
      }
      return false;
    }
    if (isStubArtifact(proposal) || isStubArtifact(design)) {
      const wasTracked = deps.awaitingChangeSet.delete(changeName);
      const released = await releaseAwaitingMarker(issue, statePath, {
        indicators,
        applyIndicator: deps.applyIndicator,
        onLog: deps.onLog,
      });
      if (wasTracked || released) {
        deps.onLog(
          `  ${issue.identifier}: confirmation detect released — proposal/design not yet filled in`,
        );
      }
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
    // prDraft: open the draft PR now so the design is reviewable in GitHub while
    // implementation streams into the same branch. The post-task PR phase flips
    // it from draft to ready once the work is done and CI is green.
    await openDraftPrOnce(
      issue,
      statePath,
      changeName,
      cwd,
      { stateObj, confirmation },
      { cfg, openDraftPr: deps.openDraftPr, onLog: deps.onLog },
    );
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
