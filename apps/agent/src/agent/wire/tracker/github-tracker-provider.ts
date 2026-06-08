/**
 * `GithubTrackerProvider` — a real issue-tracker provider that maps GitHub
 * primitives onto the shared `LinearClientLike` surface (see
 * `apps/agent/test/harness/types.ts`). It proves the backend-neutral provider
 * contract kit is genuinely tracker-agnostic by standing alongside the Linear
 * client behind the exact same structural interface.
 *
 * Two GitHub-specific divergences shape this file:
 *  1. GitHub has no status field — every lifecycle position except "done" is a
 *     **label**. Bucketing therefore needs exclusion (todo = open + selection
 *     label AND none of the lifecycle labels).
 *  2. "done" is **closing the issue**, not adding a label. `applyIndicator`
 *     recognises a done indicator and runs `gh issue close` instead of
 *     `gh issue edit --add-label`.
 *
 * The provider shells out through an injected `CmdRunner` (the `gh`
 * capability's transport), so tests drive it with a scripted runner — no
 * network, no `gh` auth, fully deterministic. It imports nothing from the
 * coordinator or the XState machines.
 */

import type { SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { CmdRunner } from "../../pr";
import type { LinearIssue } from "../../../shared/capabilities/linear-client";
import type { MentionTrigger } from "../../../queue/queue-order";
import type { LinearClientLike } from "../../../../test/harness/types";

/** `--json` fields requested from `gh issue list` / `gh issue view`. */
const ISSUE_FIELDS = "number,title,body,url,state,labels,assignees,createdAt";

/** Marker vocabulary the provider maps onto GitHub labels. */
export interface GithubMarkerVocab {
  /** Label that opts an issue into Ralphy pickup (the todo selection). */
  selectionLabel: string;
  /** Label marking an issue as actively worked. */
  inProgressLabel: string;
  /** Label marking an issue as under human review. */
  reviewLabel: string;
  /**
   * Labels whose presence on an open issue excludes it from the todo bucket
   * (in-progress / review / pr-ready / error). "done" is intentionally absent:
   * done is represented by the issue being closed, not by a label.
   */
  lifecycleLabels: string[];
}

export interface GithubTrackerDeps {
  /** Transport for `gh` invocations (the `gh` capability's runner). */
  runner: CmdRunner;
  /** Working directory passed to every `gh` call. */
  cwd: string;
  /** Target repository slug, `owner/repo`. */
  repo: string;
  /** Label vocabulary mapping lifecycle positions onto GitHub labels. */
  vocab: GithubMarkerVocab;
}

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
 * Pure mapper from a raw `gh` issue JSON object to the shared `LinearIssue`
 * shape. Kept free of any `gh` invocation so it is unit-testable in isolation.
 *
 * - `number` → `identifier` (`#<n>`) and `id` (`<n>`).
 * - `state` "CLOSED" → `{ name: "Closed", type: "completed" }` so closed
 *   issues read as done candidates; "OPEN" → `{ name: "Open", type: "started" }`.
 * - `labels[].name` → `string[]`.
 * - first `assignees[]` entry → the single `assignee` field.
 */
export function mapGithubIssue(raw: RawGithubIssue): LinearIssue {
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

/** True when an indicator's markers denote "done" (status `done` or any
 *  label whose final `:`-segment is `done`, e.g. `status:done`). */
function isDoneIndicator(set: SetIndicator): boolean {
  const markers = markersOf(set);
  return markers.some(
    (m) =>
      (m.type === "status" && m.value.toLowerCase() === "done") ||
      (m.type === "label" && /(^|:)done$/i.test(m.value)),
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
    .map((m) => m.value);
  return { kind: op === "remove" ? "remove-label" : "add-label", labels };
}

/**
 * Build a `GithubTrackerProvider` over the injected `gh` runner. Returns the
 * structural `LinearClientLike` surface; no coordinator/machine imports.
 */
export function createGithubTrackerProvider(deps: GithubTrackerDeps): LinearClientLike {
  const { runner, cwd, repo, vocab } = deps;

  const run = (args: string[]) => runner.run(["gh", ...args, "--repo", repo], cwd);

  /** Run `gh issue list` with the given state/label flags and map the output. */
  async function listIssues(flags: string[]): Promise<LinearIssue[]> {
    const { stdout } = await run(["issue", "list", ...flags, "--json", ISSUE_FIELDS]);
    const raw = JSON.parse(stdout || "[]") as RawGithubIssue[];
    return raw.map(mapGithubIssue);
  }

  return {
    fetchTodo: async () => {
      const issues = await listIssues(["--state", "open", "--label", vocab.selectionLabel]);
      // Drop issues that already carry a lifecycle label — they have moved on
      // from the todo bucket even though they keep the selection label.
      return issues.filter((i) => !i.labels.some((l) => vocab.lifecycleLabels.includes(l)));
    },
    fetchInProgress: () => listIssues(["--state", "open", "--label", vocab.inProgressLabel]),
    fetchReview: () => listIssues(["--state", "open", "--label", vocab.reviewLabel]),
    fetchDoneCandidates: () => listIssues(["--state", "closed"]),
    fetchComments: async (issueId: string) => {
      const { stdout } = await run(["issue", "view", issueId, "--json", "comments"]);
      const parsed = JSON.parse(stdout || "{}") as { comments?: { body: string }[] };
      return (parsed.comments ?? []).map((c) => ({ body: c.body }));
    },
    applyIndicator: async (issue, ind) => {
      const action = githubIndicatorAction(ind, "add");
      if (action.kind === "close") {
        await run(["issue", "close", issue.id]);
        return;
      }
      if (action.labels.length === 0) return;
      await run(["issue", "edit", issue.id, "--add-label", action.labels.join(",")]);
    },
    removeIndicator: async (issue, ind) => {
      const action = githubIndicatorAction(ind, "remove");
      if (action.kind === "close" || action.labels.length === 0) return;
      await run(["issue", "edit", issue.id, "--remove-label", action.labels.join(",")]);
    },
    postComment: async (issue, body) => {
      await run(["issue", "comment", issue.id, "--body", body]);
    },
    // M4 owns the full GitHub mention scan (cross-issue `@ralphy` search +
    // review-thread digest). For the MVP this provider returns no mentions; the
    // contract kit exercises mentions only against the fully-featured fake.
    fetchMentions: async (): Promise<{ issue: LinearIssue; trigger: MentionTrigger }[]> => [],
  };
}
