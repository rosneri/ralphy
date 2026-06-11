/**
 * `LinearTrackerProvider` — the Linear implementation of the tracker-neutral
 * {@link IssueTrackerProvider} seam (RLF-223 M1). It is a thin adapter: every
 * method delegates to the unchanged Linear transport (`linear-client.ts`) and
 * the indicator-dispatch resolvers (`linear-resolvers.ts`). No Linear logic is
 * rewritten here — this only repackages the method bag that `wire.ts`
 * previously assembled inline into `CoordinatorDeps`, so behavior is identical.
 *
 * A future `GithubTrackerProvider` (M2) implements the same interface over the
 * `gh` CLI; the coordinator never sees the difference.
 */
import type { Indicators, LinearFilterScope } from "@ralphy/types";
import type { IssueTrackerProvider, MentionTrigger, TrackedIssue } from "@ralphy/tracker";
import { addIssueComment, fetchIssueComments } from "../../../shared/capabilities/linear-client";
import { unionMarkers } from "../indicators";
import { fetchDoneCandidatesWith, type LinearResolvers } from "../linear-resolvers";

interface LinearTrackerProviderInput {
  apiKey: string;
  team: string | undefined;
  assignee: string | undefined;
  /** Filter clauses scoping done-candidate fetches, mirroring the inline wiring:
   *  `anyAssignee` widens the assignee match, `scope` carries the global
   *  label/project constraints ANDed onto every fetch. */
  anyAssignee: boolean | undefined;
  scope: LinearFilterScope;
  indicators: Indicators;
  /** The indicator-dispatch resolvers built from the same Linear config.
   *  Shared with the rest of `wire.ts` (spawn, confirmation, baseline gate). */
  resolvers: LinearResolvers;
  /** The mention scanner is assembled separately in `wire.ts` because it also
   *  needs PR-discovery / per-change state; the provider just surfaces it. */
  fetchMentions: () => Promise<{ issue: TrackedIssue; trigger: MentionTrigger }[]>;
  /** RLF-208: when non-empty, done-candidate fetches are constrained to these
   *  Linear ticket numbers (from `--ticket`). */
  ticketNumbers?: number[] | undefined;
  /** Injectable comment IO. Defaults to the Linear client; tests inject a
   *  recorder here instead of `mock.module`-ing the shared client (bun's mock
   *  registry is process-global, so an incomplete module mock breaks every
   *  other in-process importer). */
  commentsIo?: {
    addIssueComment: typeof addIssueComment;
    fetchIssueComments: typeof fetchIssueComments;
  };
}

export function createLinearTrackerProvider(
  input: LinearTrackerProviderInput,
): IssueTrackerProvider {
  const {
    apiKey,
    team,
    assignee,
    anyAssignee,
    scope,
    indicators,
    resolvers,
    fetchMentions,
    ticketNumbers,
  } = input;
  const comments = input.commentsIo ?? { addIssueComment, fetchIssueComments };

  // setDone/setError exclude an issue from the todo pool; setError alone keeps
  // an in-progress issue from being re-resumed. Mirrors the prior inline wiring.
  const excludeFromTodo = unionMarkers(indicators.setDone, indicators.setError);
  const excludeFromInProgress = unionMarkers(indicators.setError);

  return {
    fetchTodo: () => resolvers.fetchByGet(indicators.getTodo, excludeFromTodo),
    fetchInProgress: () => resolvers.fetchByGet(indicators.getInProgress, excludeFromInProgress),
    fetchReview: () => resolvers.fetchByGet(indicators.getReview, []),
    fetchMentions,
    fetchDoneCandidates: () =>
      fetchDoneCandidatesWith(
        apiKey,
        team,
        assignee,
        anyAssignee,
        scope,
        indicators,
        ticketNumbers && ticketNumbers.length > 0 ? ticketNumbers : undefined,
      ),
    applyIndicator: resolvers.applyIndicator,
    removeIndicator: resolvers.removeIndicator,
    postComment: (issue, body) => comments.addIssueComment(apiKey, issue.id, body),
    fetchComments: async (issueId) => {
      const c = await comments.fetchIssueComments(apiKey, issueId);
      return c.map((x: { body: string }) => ({ body: x.body }));
    },
  };
}
