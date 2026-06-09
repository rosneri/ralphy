import type { Indicators, LinearFilterScope } from "@ralphy/types";
import {
  createLinearResolvers,
  fetchDoneCandidatesWith,
  type LinearResolvers,
} from "../linear-resolvers";
import type { TrackerProvider } from "./types";

interface LinearProviderInput {
  apiKey: string;
  team: string | undefined;
  assignee: string | undefined;
  /** When true, fetch regardless of assignee (`assignee = any`). */
  anyAssignee?: boolean | undefined;
  /** Global `linear.filter` label/project constraints ANDed onto every fetch. */
  scope: LinearFilterScope;
  /** The configured indicator map; `fetchDoneCandidates` unions over it. */
  indicators: Indicators;
  diag: (area: string, message: string, color?: string) => void;
  /** RLF-208: when non-empty, every query is constrained to these ticket numbers. */
  ticketNumbers?: number[] | undefined;
}

/**
 * Linear tracker provider, backed by the GraphQL transport through the resolver
 * bag. Selected by `tracker.kind: linear` (the default); conforms to
 * {@link TrackerProvider} so `wire.ts` can thread it wherever the GitHub
 * provider is used, symmetric with {@link createGithubTrackerProvider}.
 *
 * Returns the wire-local `TrackerProvider` plus the `resolvers` handle the
 * coordinator seam (`createLinearTrackerProvider`) still consumes — mirroring
 * the way the GitHub factory returns its `listOpenIssues` / `repo` handles.
 *
 * `fetchDoneCandidates` is bound from the standalone {@link fetchDoneCandidatesWith}
 * helper (it needs the indicator map, which the resolver bag does not carry).
 * This is a pure construction-site move: same transport calls, same filters,
 * same done-candidate union as the inline literal it replaces.
 */
export function createLinearProvider(
  input: LinearProviderInput,
): TrackerProvider & { resolvers: LinearResolvers } {
  const { apiKey, team, assignee, anyAssignee, scope, indicators, diag } = input;
  const ticketNumbers =
    input.ticketNumbers && input.ticketNumbers.length > 0 ? input.ticketNumbers : undefined;

  const resolvers = createLinearResolvers({
    apiKey,
    team,
    assignee,
    anyAssignee,
    scope,
    diag,
    ...(ticketNumbers ? { ticketNumbers } : {}),
  });

  return {
    ...resolvers,
    fetchDoneCandidates: () =>
      fetchDoneCandidatesWith(
        apiKey,
        team,
        assignee,
        anyAssignee,
        scope,
        indicators,
        ticketNumbers,
      ),
    resolvers,
  };
}
