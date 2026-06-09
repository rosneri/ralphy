import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { CmdRunner } from "../../pr";
import type { LinearIssue } from "../../linear";
import type { TrackerProvider } from "./types";

/** Resolved `github.issues` settings (defaults already applied by the schema). */
export interface GithubIssuesConfig {
  repo?: string | undefined;
  label?: string | undefined;
  assignee?: string | undefined;
  statusLabels: { inProgress: string; done: string; error: string };
}

interface GithubTrackerInput {
  /** The `github.issues` config block, or undefined (defaults are used). */
  issues: GithubIssuesConfig | undefined;
  cmdRunner: CmdRunner;
  /** Repo root, used to detect the `origin` repo when `issues.repo` is unset. */
  projectRoot: string;
  diag: (area: string, message: string, color?: string) => void;
}

/** Shape of a `gh issue list --json ...` entry. */
interface GhIssue {
  number: number;
  title: string;
  url: string;
  body?: string | null;
  state?: string;
  createdAt?: string;
  labels?: { name: string }[];
}

const DEFAULT_STATUS_LABELS = {
  inProgress: "ralph:in-progress",
  done: "ralph:done",
  error: "ralph:error",
};

/** The GitHub issue number, formatted as a slug-safe loop identifier. */
function identifierForNumber(n: number): string {
  return `issue-${n}`;
}

/** Map a `gh` issue into the `LinearIssue` shape the loop consumes. The fields
 *  the loop never reads are filled with inert defaults. */
function toLinearIssue(gh: GhIssue): LinearIssue {
  const open = (gh.state ?? "OPEN").toUpperCase() === "OPEN";
  return {
    id: String(gh.number),
    identifier: identifierForNumber(gh.number),
    title: gh.title,
    description: gh.body ?? null,
    url: gh.url,
    state: { name: open ? "Open" : "Closed", type: open ? "started" : "completed" },
    assignee: null,
    project: null,
    labels: (gh.labels ?? []).map((l) => l.name),
    priority: 0,
    createdAt: gh.createdAt ?? "",
    blockedByIds: [],
  };
}

/** The label values of a marker list (status/comment/etc. are ignored). */
function labelValues(markers: Marker[]): string[] {
  return markers.filter((m) => m.type === "label").map((m) => m.value);
}

/**
 * GitHub Issues tracker provider, backed by the `gh` CLI through the shared
 * {@link CmdRunner}. Selected by `tracker.kind: github`; conforms to
 * {@link TrackerProvider} so `wire.ts` can thread it wherever the Linear
 * resolvers are used today.
 *
 * The loop drives the provider with label markers synthesized in `wire.ts`
 * from the `github.issues` config (todo label → in-progress → done/error), so
 * this provider only has to translate label/comment markers into `gh` calls:
 * fetching by label, moving labels, commenting, and closing on done.
 */
export function createGithubTrackerProvider(input: GithubTrackerInput): TrackerProvider & {
  /** List open issues for the mention scan (todo + in-progress, no Search-API). */
  listOpenIssues: () => Promise<LinearIssue[]>;
  /** Resolve the `owner/name` slug (configured, else detected from origin). */
  repo: () => Promise<string>;
} {
  const { cmdRunner, projectRoot, diag } = input;
  const statusLabels = input.issues?.statusLabels ?? DEFAULT_STATUS_LABELS;
  const todoLabel = input.issues?.label;
  const assignee = input.issues?.assignee;
  const configuredRepo = input.issues?.repo;

  let repoPromise: Promise<string> | null = null;

  /** The `owner/name` to operate on — configured, else detected from origin. */
  async function repo(): Promise<string> {
    if (configuredRepo && configuredRepo.trim() !== "") return configuredRepo.trim();
    if (!repoPromise) {
      repoPromise = (async () => {
        try {
          const { stdout } = await cmdRunner.run(
            ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            projectRoot,
          );
          const detected = stdout.trim();
          if (!detected) throw new Error("empty");
          diag("github-tracker", `  using detected GitHub repo ${detected}`, "gray");
          return detected;
        } catch (err) {
          throw new Error(
            "github tracker: could not determine the repository — set " +
              "`github.issues.repo` (owner/name) in WORKFLOW.md or run inside a " +
              `repo with a GitHub 'origin' remote (${(err as Error).message})`,
          );
        }
      })();
    }
    return repoPromise;
  }

  async function listIssues(args: string[]): Promise<LinearIssue[]> {
    const r = await repo();
    const { stdout } = await cmdRunner.run(
      [
        "gh",
        "issue",
        "list",
        "--repo",
        r,
        "--state",
        "open",
        "--json",
        "number,title,url,body,state,createdAt,labels",
        "--limit",
        "100",
        ...args,
      ],
      projectRoot,
    );
    const parsed = JSON.parse(stdout.trim() || "[]") as GhIssue[];
    return parsed.map(toLinearIssue);
  }

  async function fetchByGet(
    inc: SetIndicator | { filter: Marker[] } | undefined,
    excl: Marker[],
  ): Promise<LinearIssue[]> {
    if (!inc) return [];
    const include = !Array.isArray(inc) && "filter" in inc ? inc.filter : [];
    const wantLabels = labelValues(include);
    // The synthesized todo indicator carries the configured todo label; an
    // empty filter means "no label constraint" — list every open issue.
    const args: string[] = [];
    for (const label of wantLabels) args.push("--label", label);
    if (assignee && assignee.trim() !== "") args.push("--assignee", assignee.trim());
    const issues = await listIssues(args);
    const excludeLabels = new Set(labelValues(excl));
    if (excludeLabels.size === 0) return issues;
    return issues.filter((issue) => !issue.labels.some((l) => excludeLabels.has(l)));
  }

  async function ghIssue(issueNumber: string, ...args: string[]): Promise<void> {
    const r = await repo();
    await cmdRunner.run(["gh", "issue", ...args, issueNumber, "--repo", r], projectRoot);
  }

  async function applyMarker(issue: LinearIssue, m: Marker): Promise<void> {
    if (m.type === "comment") {
      await ghIssue(issue.id, "comment", "--body", m.value);
      diag("github-marker", `  → ${issue.identifier} comment`, "gray");
      return;
    }
    if (m.type !== "label") {
      // status / project / attachment have no GitHub-issue equivalent; the
      // synthesized indicators never emit them, so this only guards a
      // hand-rolled config.
      diag(
        "github-marker",
        `! ${issue.identifier}: '${m.type}' markers are not supported by the GitHub tracker — skipped`,
        "yellow",
      );
      return;
    }
    await ghIssue(issue.id, "edit", "--add-label", m.value);
    diag("github-marker", `  → ${issue.identifier} +label='${m.value}'`, "gray");
    // Moving into in-progress vacates the todo label so the issue leaves the
    // pickup pool; reaching done closes the issue.
    if (m.value === statusLabels.inProgress && todoLabel && todoLabel.trim() !== "") {
      await ghIssue(issue.id, "edit", "--remove-label", todoLabel.trim());
      diag("github-marker", `  → ${issue.identifier} -label='${todoLabel.trim()}'`, "gray");
    }
    if (m.value === statusLabels.done) {
      await ghIssue(issue.id, "close");
      diag("github-marker", `  → ${issue.identifier} closed`, "gray");
    }
  }

  async function applyIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) await applyMarker(issue, m);
  }

  async function removeIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) {
      if (m.type !== "label") continue;
      await ghIssue(issue.id, "edit", "--remove-label", m.value);
      diag("github-marker", `  → ${issue.identifier} -label='${m.value}'`, "gray");
    }
  }

  /** Open issues the mention scan reads comments for: the todo bucket plus
   *  in-progress (a picked-up issue sheds the todo label, so it would otherwise
   *  fall out of scope), deduped by number. With no configured todo label every
   *  open issue is the todo bucket, so a single unfiltered list suffices. No
   *  Search-API. */
  async function listOpenIssues(): Promise<LinearIssue[]> {
    if (!todoLabel || todoLabel.trim() === "") return listIssues([]);
    const [todo, inProgress] = await Promise.all([
      listIssues(["--label", todoLabel.trim()]),
      listIssues(["--label", statusLabels.inProgress]),
    ]);
    const byId = new Map<string, LinearIssue>();
    for (const i of [...todo, ...inProgress]) byId.set(i.id, i);
    return [...byId.values()];
  }

  async function fetchDoneCandidates(): Promise<LinearIssue[]> {
    // Issues still carrying the in-progress label are the ones whose PRs the
    // watcher scans for conflict / CI status.
    return listIssues(["--label", statusLabels.inProgress]);
  }

  // GitHub has no team-scoped label-id concept; the baseline gate's Linear
  // label creation is a no-op here.
  async function resolveLabelIdForTeam(): Promise<string | null> {
    return null;
  }

  return {
    fetchByGet,
    applyIndicator,
    removeIndicator,
    applyMarker,
    fetchDoneCandidates,
    resolveLabelIdForTeam,
    listOpenIssues,
    repo,
  };
}

/**
 * Synthesize the label-based {@link Indicators} the loop drives the GitHub
 * provider with, from the `github.issues` config. The whole coordinator then
 * works uniformly: get-todo by the todo label (or every open issue when blank),
 * and move the issue through the in-progress / done / error status labels. The
 * GitHub provider translates these label markers into `gh` calls.
 */
export function githubIndicators(issues: GithubIssuesConfig | undefined): Indicators {
  const statusLabels = issues?.statusLabels ?? DEFAULT_STATUS_LABELS;
  const todoLabel = issues?.label?.trim();
  return {
    getTodo: { filter: todoLabel ? [{ type: "label", value: todoLabel }] : [] },
    getInProgress: { filter: [{ type: "label", value: statusLabels.inProgress }] },
    setInProgress: { type: "label", value: statusLabels.inProgress },
    setDone: { type: "label", value: statusLabels.done },
    setError: { type: "label", value: statusLabels.error },
  };
}

/** Exported for tests. */
export { identifierForNumber };
