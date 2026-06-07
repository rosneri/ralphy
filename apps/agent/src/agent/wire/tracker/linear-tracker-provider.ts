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
import type { Indicators } from "@ralphy/types";
import type { IssueTrackerProvider, MentionTrigger, TrackedIssue } from "@ralphy/tracker";
import { addIssueComment, fetchIssueComments } from "../../linear";
import { unionMarkers } from "../indicators";
import { fetchDoneCandidatesWith, type LinearResolvers } from "../linear-resolvers";

export interface LinearTrackerProviderInput {
  apiKey: string;
  team: string | undefined;
  assignee: string | undefined;
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
}

export function createLinearTrackerProvider(
  input: LinearTrackerProviderInput,
): IssueTrackerProvider {
  const { apiKey, team, assignee, indicators, resolvers, fetchMentions, ticketNumbers } = input;

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
        indicators,
        ticketNumbers && ticketNumbers.length > 0 ? ticketNumbers : undefined,
      ),
    applyIndicator: resolvers.applyIndicator,
    removeIndicator: resolvers.removeIndicator,
    postComment: (issue, body) => addIssueComment(apiKey, issue.id, body),
    fetchComments: async (issueId) => {
      const c = await fetchIssueComments(apiKey, issueId);
      return c.map((x) => ({ body: x.body }));
    },
  };
}
