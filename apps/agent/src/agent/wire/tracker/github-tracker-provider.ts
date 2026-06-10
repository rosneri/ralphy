/**
 * `GithubTrackerProvider` — the GitHub implementation of the tracker-neutral
 * {@link IssueTrackerProvider} seam (from `@ralphy/tracker`), symmetric with
 * `createLinearTrackerProvider`. It is a thin adapter: every method delegates
 * to the `gh`-CLI transport (`createGithubProvider` in `./github`) and the
 * synthesized label indicators, so GitHub-specific semantics (label buckets,
 * "done" = closing the issue) live in the transport, not here. The coordinator
 * never sees the difference between this and the Linear seam.
 *
 * Two GitHub-specific divergences inform the surface (handled in the transport):
 *  1. GitHub has no status field — every lifecycle position except "done" is a
 *     **label**. `fetchReview` therefore has no `getReview` indicator to poll
 *     and intentionally returns `[]`; review re-engagement flows through
 *     `fetchMentions`.
 *  2. "done" is **closing the issue**, not adding a label — the transport's
 *     `applyMarker` runs `gh issue close` on the done label.
 *
 * This file also retains pure, transport-agnostic helpers (`mapGithubIssue`,
 * `flattenLabel`, `githubIndicatorAction`, `staleStatusLabels`) reused by the
 * test harness's fake GitHub provider. It imports nothing from the coordinator
 * or the XState machines.
 */

import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { IssueTrackerProvider, MentionTrigger, TrackedIssue } from "@ralphy/tracker";
import { unionMarkers } from "../indicators";
import type { createGithubProvider } from "./github";

/** Shape of a single issue in `gh issue list --json …` / `gh issue view`. */
interface RawGithubIssue {
  number: number;
  title?: string;
  body?: string | null;
  url?: string;
  /** "OPEN" | "CLOSED" (case-insensitive). */
  state?: string;
  labels?: { name: string }[];
  assignees?: { id?: string; login?: string; name?: string }[];
  createdAt?: string;
}

/**
 * Pure mapper from a raw `gh` issue JSON object to the shared `TrackedIssue`
 * shape. Kept free of any `gh` invocation so it is unit-testable in isolation.
 *
 * - `number` → `identifier` (`#<n>`) and `id` (`<n>`).
 * - `state` "CLOSED" → `{ name: "Closed", type: "completed" }` so closed
 *   issues read as done candidates; "OPEN" → `{ name: "Open", type: "started" }`.
 * - `labels[].name` → `string[]`.
 * - first `assignees[]` entry → the single `assignee` field.
 */
export function mapGithubIssue(raw: RawGithubIssue): TrackedIssue {
  const closed = (raw.state ?? "OPEN").toUpperCase() === "CLOSED";
  const first = raw.assignees?.[0];
  return {
    id: String(raw.number),
    identifier: `#${raw.number}`,
    title: raw.title ?? "",
    description: raw.body ?? null,
    url: raw.url ?? "",
    state: closed ? { name: "Closed", type: "completed" } : { name: "Open", type: "started" },
    assignee: first
      ? { id: first.id ?? first.login ?? "", email: null, name: first.name ?? first.login ?? "" }
      : null,
    project: null,
    labels: (raw.labels ?? []).map((l) => l.name),
    priority: 3,
    createdAt: raw.createdAt ?? "",
    blockedByIds: [],
  };
}

/**
 * Flatten a marker to the literal GitHub label name it applies. GitHub has no
 * label groups (Linear does), so a grouped `label` marker
 * (`{ type: "label", value: "error", group: "Ralphy" }`) collapses to the
 * single flat label `Ralphy:error` — matching the nested name Linear resolves.
 * An ungrouped `label` marker keeps its bare `value`; non-`label` markers are
 * returned unchanged (their `value`).
 */
export function flattenLabel(marker: Marker): string {
  if (marker.type === "label" && marker.group) return `${marker.group}:${marker.value}`;
  return marker.value;
}

/** True when an indicator's markers denote "done" (status `done` or any
 *  label whose final `:`-segment is `done`, e.g. `status:done` or a grouped
 *  `{ value: "done", group: "status" }` that flattens to `status:done`). */
function isDoneIndicator(set: SetIndicator): boolean {
  const markers = markersOf(set);
  return markers.some(
    (m) =>
      (m.type === "status" && m.value.toLowerCase() === "done") ||
      (m.type === "label" && /(^|:)done$/i.test(flattenLabel(m))),
  );
}

/**
 * Pure classifier: decides whether applying/removing an indicator means
 * closing the issue (the done fork) or editing labels. The single behavioural
 * place GitHub semantics diverge from "just apply the marker".
 *
 * @param set indicator to classify.
 * @param op whether the caller intends to add (default) or remove labels. Only
 *   the add path can resolve to a close — removing a done marker is a no-op
 *   label edit, never a re-open.
 */
export function githubIndicatorAction(
  set: SetIndicator,
  op: "add" | "remove" = "add",
): { kind: "close" } | { kind: "add-label" | "remove-label"; labels: string[] } {
  if (op === "add" && isDoneIndicator(set)) return { kind: "close" };
  const labels = markersOf(set)
    .filter((m) => m.type === "label")
    .map(flattenLabel);
  return { kind: op === "remove" ? "remove-label" : "add-label", labels };
}

/**
 * Existing `prefix`-namespaced labels on an issue that must be stripped when
 * `addLabels` are applied, to preserve the single-active-status invariant: an
 * open issue carries at most one label under `prefix`. Returns the labels in
 * `currentLabels` that start with `prefix` but are not among `addLabels` (so a
 * status being re-applied is never reported as stale). Non-`prefix` labels are
 * never returned — only the status namespace is single-valued.
 */
export function staleStatusLabels(
  currentLabels: string[],
  addLabels: string[],
  prefix: string,
): string[] {
  const adding = new Set(addLabels);
  return currentLabels.filter((l) => l.startsWith(prefix) && !adding.has(l));
}

/**
 * The gh-CLI transport (`createGithubProvider`) the coordinator seam delegates
 * to — only the subset of methods the seam threads through. Typed off the
 * transport's own return type so the two cannot drift.
 */
type GithubTransport = Pick<
  ReturnType<typeof createGithubProvider>,
  | "fetchByGet"
  | "fetchDoneCandidates"
  | "applyIndicator"
  | "removeIndicator"
  | "applyMarker"
  | "fetchComments"
>;

/** Input for the GitHub coordinator seam, assembled in `wire.ts`. Mirrors
 *  `createLinearTrackerProvider`'s shape: the transport plus the synthesized
 *  indicators, todo-exclusion set, and separately-built mention scanner. */
interface GithubTrackerProviderInput {
  /** The gh-CLI transport (`createGithubProvider`) the seam delegates to. */
  provider: GithubTransport;
  /** Label-based indicators synthesized from `github.issues`. */
  indicators: Indicators;
  /** Markers excluding an issue from the todo pool (done / error / in-progress).
   *  Built by `wire.ts` because GitHub's blank-todo-label fetch lists every open
   *  issue, so in-progress must be excluded too. */
  excludeFromTodo: Marker[];
  /** GitHub mention scanner, assembled separately in `wire.ts` (it needs
   *  PR-discovery / per-change state the seam does not). */
  fetchMentions: () => Promise<{ issue: TrackedIssue; trigger: MentionTrigger }[]>;
}

/**
 * Build the GitHub coordinator seam by delegating to the `gh` transport, the
 * single named factory symmetric with `createLinearTrackerProvider`. No `gh`
 * calls are issued here — GitHub-specific behavior (label buckets, "done" =
 * close, commenting) lives in the transport's `applyMarker` / `fetchByGet`.
 */
export function createGithubTrackerProvider(
  input: GithubTrackerProviderInput,
): IssueTrackerProvider {
  const { provider, indicators, excludeFromTodo, fetchMentions } = input;
  return {
    fetchTodo: () => provider.fetchByGet(indicators.getTodo, excludeFromTodo),
    fetchInProgress: () =>
      provider.fetchByGet(indicators.getInProgress, unionMarkers(indicators.setError)),
    // Intentionally empty, NOT an unfinished stub: GitHub emits no `getReview`
    // indicator and the coordinator does not poll `fetchReview`; GitHub review
    // re-engagement flows through `fetchMentions`. Symmetric with Linear's
    // polling model.
    fetchReview: async () => [],
    fetchMentions,
    fetchDoneCandidates: () => provider.fetchDoneCandidates(),
    // Real comments via `gh issue view --json comments`, backing the
    // coordinator's started-idempotency check.
    fetchComments: (issueId) => provider.fetchComments(issueId),
    applyIndicator: provider.applyIndicator,
    removeIndicator: provider.removeIndicator,
    // Progress comments route through a `gh issue comment` via the transport's
    // comment marker.
    postComment: (issue, body) => provider.applyMarker(issue, { type: "comment", value: body }),
  };
}
