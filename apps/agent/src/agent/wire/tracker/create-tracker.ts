/**
 * `createTracker` — the ONLY place `cfg.tracker.kind` is read (issue #403).
 *
 * Everything backend-specific that `wire.ts` used to branch on inline —
 * indicator synthesis, transport construction, mention scanning, the
 * `IssueTracker` facade extras (sticky upsert, PR links, blockers,
 * attachments), comment mutations, and the spec sink (RLF-239) — is selected
 * here once and returned as one bundle. Downstream code consumes the bundle's
 * capabilities and never branches on the tracker kind again.
 */

import type { Indicators, LinearFilterScope } from "@ralphy/types";
import { createIssueTracker, type IssueAttachments, type IssueTracker } from "@ralphy/tracker";
import type { TrackedIssue } from "@ralphy/tracker";
import type { RalphyCommentType } from "@ralphy/comms";
import { findStickyComment } from "@ralphy/comms";
import type { AgentParsedArgs } from "../../../cli";
import type { RalphyConfig } from "../../config";
import type { CmdRunner } from "../../pr";
import type { CommentMutations } from "../../linear-sync/comment-sync";
import {
  attachmentMutationsFromCapability,
  createAttachmentSpecSink,
  type SpecSink,
} from "../../linear-sync/spec-sink";
import { fetchBlockedByForIssues } from "../../../shared/capabilities/linear-client/issues";
import {
  createIssueComment,
  deleteIssueComment,
  fetchIssueComments,
  updateIssueComment,
} from "../../../shared/capabilities/linear-client/comments";
import {
  createAttachmentForUrl,
  deleteAttachment,
  fetchIssueAttachments,
  findIssueAttachmentByTitle,
  uploadFileToLinear,
} from "../../../shared/capabilities/linear-client/attachments";
import { discoverPrUrlFromGitHub } from "../../pr-url";
import { mergeIndicators, unionMarkers } from "../indicators";
import { createMentionScanner } from "../mention-scan";
import { createGithubMentionScanner } from "../mention-scan/github-scanner";
import { createGithubCommentSpecSink } from "../comment-sync";
import { createGithubProvider, githubIndicators } from "./github";
import { createGithubCommentMutations } from "./github-comment-mutations";
import { createGithubTrackerProvider } from "./github-tracker-provider";
import { createLinearProvider } from "./linear";
import { createLinearTrackerProvider } from "./linear-tracker-provider";
import { upsertStickyComment } from "./sticky-comment";
import type { TrackerProvider } from "./types";

export interface CreateTrackerInput {
  cfg: RalphyConfig;
  args: AgentParsedArgs;
  apiKey: string;
  projectRoot: string;
  useWorktree: boolean;
  cmdRunner: CmdRunner;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  team: string | undefined;
  assignee: string | undefined;
  anyAssignee: boolean | undefined;
  scope: LinearFilterScope;
  ticketNumbers: number[];
  cwdByChange: Map<string, string>;
  stalePingedAt: Map<string, number>;
  lastHandledReviewActivity: Map<string, string>;
  resolvePrUrlForIssue: (issue: TrackedIssue) => Promise<string | null>;
}

/** Everything the wire layer needs from the selected backend, in one bag. */
interface TrackerBundle {
  /** The complete facade the coordinator consumes. */
  tracker: IssueTracker;
  /** Indicators resolved for this backend (synthesized labels on GitHub;
   *  config ⊕ CLI overrides on Linear) — returned together with the tracker
   *  so the last indicator-synthesis branch dies with the rest. */
  indicators: Indicators;
  /** Transport-level ops (applyMarker, resolveLabelIdForTeam, …) still used
   *  directly by spawn / confirmation / baseline. */
  transport: TrackerProvider;
  /** Comment-sync IO for this backend (plan/tasks/steering comments). */
  commentMutations: CommentMutations;
  /** How `syncSpecsAsAttachments` content reaches the issue (RLF-239). */
  specSink: SpecSink;
  /** Whether the backend's credentials are usable (Linear needs an API key;
   *  GitHub auth flows through the `gh` CLI). */
  credentialsReady: boolean;
}

/** Best-effort Linear sticky upsert: re-discover the marker-tagged comment by
 *  scanning the issue's comments, edit it in place when present, else create
 *  it. Failures are logged and swallowed — a cosmetic sticky comment must not
 *  crash an iteration. */
function linearStickyUpsert(
  apiKey: string,
  diag: CreateTrackerInput["diag"],
): (issue: TrackedIssue, type: RalphyCommentType, body: string) => Promise<void> {
  return async (issue, type, body) => {
    try {
      const comments = await fetchIssueComments(apiKey, issue.id);
      const existing = findStickyComment(comments, type);
      if (existing) {
        await updateIssueComment(apiKey, existing.id, body);
      } else {
        await createIssueComment(apiKey, issue.id, body);
      }
    } catch (err) {
      diag(
        "sticky-comment",
        `! could not upsert ${type} comment on ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  };
}

/** The Linear attachment capability over the GraphQL client. */
function linearAttachments(apiKey: string): IssueAttachments {
  return {
    uploadFile: async (input) => (await uploadFileToLinear(apiKey, input)).assetUrl,
    attachUrl: (issueId, url, title, subtitle) =>
      createAttachmentForUrl(apiKey, {
        issueId,
        url,
        title,
        ...(subtitle !== undefined ? { subtitle } : {}),
      }),
    findByTitle: (issueId, title) => findIssueAttachmentByTitle(apiKey, issueId, title),
    delete: (attachmentId) => deleteAttachment(apiKey, attachmentId),
  };
}

export function createTracker(input: CreateTrackerInput): TrackerBundle {
  const { cfg, args, apiKey, projectRoot, cmdRunner, onLog, diag } = input;

  if (cfg.tracker.kind === "github") {
    // GitHub mode synthesizes label-based indicators from `github.issues` and
    // drives the loop off the `gh` CLI (RLF-234).
    const indicators = githubIndicators(cfg.github?.issues);
    const transport = createGithubProvider({
      issues: cfg.github?.issues,
      cmdRunner,
      projectRoot,
      diag,
    });
    // GitHub lists open issues by label; without a dedicated todo label the
    // todo fetch returns every open issue, so the in-progress label must also
    // be excluded or in-flight work is re-picked.
    const excludeFromTodo = unionMarkers(
      indicators.setDone,
      indicators.setError,
      indicators.setInProgress,
    );
    const fetchMentions = createGithubMentionScanner({
      cfg,
      cmdRunner,
      projectRoot,
      onLog,
      diag,
      listOpenIssues: transport.listOpenIssues,
      repo: transport.repo,
    });
    const provider = createGithubTrackerProvider({
      provider: transport,
      indicators,
      excludeFromTodo,
      fetchMentions,
    });
    const tracker = createIssueTracker(provider, {
      upsertStickyComment: async (issue, type, body) =>
        upsertStickyComment({
          cmdRunner,
          repo: await transport.repo(),
          projectRoot,
          issueNumber: issue.id,
          type,
          body,
          diag,
        }),
      // GitHub records PR links as development references; the loop's
      // durable signal is the identifier-scoped PR search.
      fetchPullRequestLinks: async (issue) => {
        const url = await discoverPrUrlFromGitHub(issue.identifier, cmdRunner, projectRoot, onLog);
        return url ? [url] : [];
      },
      // No first-class blocked-by relation on GitHub issues; blockers are
      // advisory to the coordinator, so an empty refresh is acceptable
      // (documented in the RFC). `blockedByIds` stays [] from the transport.
      fetchBlockers: async () => [],
      attachments: null,
    });
    return {
      tracker,
      indicators,
      transport,
      commentMutations: createGithubCommentMutations({
        cmdRunner,
        projectRoot,
        repo: transport.repo,
        diag,
      }),
      specSink: createGithubCommentSpecSink({
        cmdRunner,
        projectRoot,
        repo: transport.repo,
        diag,
      }),
      credentialsReady: true,
    };
  }

  const indicators = mergeIndicators(
    cfg.linear.indicators as Record<string, unknown>,
    args.indicators,
  );
  const { team, assignee, anyAssignee, scope, ticketNumbers } = input;
  const transport = createLinearProvider({
    apiKey,
    team,
    assignee,
    anyAssignee,
    scope,
    indicators,
    diag,
    ...(ticketNumbers.length > 0 ? { ticketNumbers } : {}),
  });
  const fetchMentions = createMentionScanner({
    apiKey,
    cfg,
    team,
    assignee,
    anyAssignee,
    scope,
    indicators,
    projectRoot,
    useWorktree: input.useWorktree,
    cmdRunner,
    onLog,
    diag,
    cwdByChange: input.cwdByChange,
    ...(ticketNumbers.length > 0 ? { ticketNumbers } : {}),
    stalePingedAt: input.stalePingedAt,
    lastHandledReviewActivity: input.lastHandledReviewActivity,
    resolvePrUrlForIssue: input.resolvePrUrlForIssue,
  });
  const provider = createLinearTrackerProvider({
    apiKey,
    team,
    assignee,
    anyAssignee,
    scope,
    indicators,
    resolvers: transport.resolvers,
    fetchMentions,
    ...(ticketNumbers.length > 0 ? { ticketNumbers } : {}),
  });
  const attachments = linearAttachments(apiKey);
  const tracker = createIssueTracker(provider, {
    upsertStickyComment: linearStickyUpsert(apiKey, diag),
    fetchPullRequestLinks: async (issue) =>
      (await fetchIssueAttachments(apiKey, issue.id)).map((a) => a.url),
    fetchBlockers: async (issueId) =>
      (await fetchBlockedByForIssues(apiKey, [issueId])).get(issueId) ?? [],
    attachments,
  });
  return {
    tracker,
    indicators,
    transport,
    commentMutations: { createIssueComment, updateIssueComment, deleteIssueComment },
    specSink: createAttachmentSpecSink({
      apiKey,
      mutations: attachmentMutationsFromCapability(attachments),
      ...(cfg.linear.specAttachmentFormats !== undefined
        ? { formats: cfg.linear.specAttachmentFormats }
        : {}),
      ...(cfg.linear.specAttachmentRevisions !== undefined
        ? { sealedRevisionMode: cfg.linear.specAttachmentRevisions }
        : {}),
    }),
    credentialsReady: Boolean(apiKey),
  };
}
