import { dirname, join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import { writeField } from "@ralphy/core/state";
import { changeNameForIssue } from "../../agent/scaffold";
import { worktreesDir } from "../../agent/worktree";
import type { LinearIssue } from "../../agent/linear";
import type { CmdRunner } from "../../agent/pr";
import type { MentionTrigger } from "../../agent/coordinator";

export interface PrReviewThreadComment {
  author?: string;
  body: string;
  createdAt: string;
  url?: string;
}
export interface PrReviewThread {
  isResolved: boolean;
  path?: string;
  line?: number;
  comments: PrReviewThreadComment[];
}
export interface PrReviewState {
  isOpen: boolean;
  merged: boolean;
  approved: boolean;
  threads: PrReviewThread[];
  requestedReviewer?: string;
  lastReviewer?: string;
}

export interface ReviewScanDeps {
  cmdRunner: CmdRunner;
  projectRoot: string;
  useWorktree: boolean;
  staleHours: number;
  cwdOf: (changeName: string) => string | undefined;
  lastHandledReviewActivity: Map<string, string>;
  stalePingedAt: Map<string, number>;
  onLog: (msg: string, color?: string) => void;
}

/** Resolve the directory holding `.ralph-state.json` for the change tied
 *  to `changeName`, or null when the change has not been scaffolded yet. */
export async function resolveReviewStateDir(
  changeName: string,
  deps: { projectRoot: string; useWorktree: boolean; cwdOf: (cn: string) => string | undefined },
): Promise<string | null> {
  const root = deps.cwdOf(changeName);
  if (root) return dirname(projectLayout(root).stateFile(changeName));
  if (!deps.useWorktree) return dirname(projectLayout(deps.projectRoot).stateFile(changeName));
  const wtPath = join(worktreesDir(deps.projectRoot), changeName);
  const statePath = projectLayout(wtPath).stateFile(changeName);
  if (await Bun.file(statePath).exists()) return dirname(statePath);
  return null;
}

/** Read `review.lastConsumedCommentAt` from `.ralph-state.json` in the
 *  given dir. */
export async function readReviewWatermark(stateDir: string): Promise<string | null> {
  const file = Bun.file(join(stateDir, ".ralph-state.json"));
  if (!(await file.exists())) return null;
  try {
    const parsed = (await file.json()) as { review?: { lastConsumedCommentAt?: string | null } };
    return parsed?.review?.lastConsumedCommentAt ?? null;
  } catch {
    return null;
  }
}

/** Query the PR's review state + threads via the GraphQL endpoint. */
export async function fetchPrReviewState(
  prUrl: string,
  cmdRunner: CmdRunner,
  projectRoot: string,
  onLog: (msg: string, color?: string) => void,
): Promise<PrReviewState | null> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!m) return null;
  const [, owner, repo, num] = m;
  const query = `query($owner:String!,$repo:String!,$num:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$num){
        state merged reviewDecision
        reviewRequests(first:5){nodes{requestedReviewer{... on User{login}}}}
        latestReviews(first:5){nodes{author{login} state submittedAt}}
        reviewThreads(first:50){nodes{
          isResolved path line
          comments(first:20){nodes{body author{login} createdAt url}}
        }}
      }
    }
  }`;
  try {
    const res = await cmdRunner.run(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `repo=${repo}`,
        "-F",
        `num=${num}`,
      ],
      projectRoot,
    );
    const parsed = JSON.parse(res.stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            state: string;
            merged: boolean;
            reviewDecision: string | null;
            reviewRequests?: { nodes: { requestedReviewer?: { login?: string } | null }[] };
            latestReviews?: {
              nodes: { author?: { login?: string } | null; state: string; submittedAt: string }[];
            };
            reviewThreads?: {
              nodes: {
                isResolved: boolean;
                path?: string | null;
                line?: number | null;
                comments: {
                  nodes: {
                    body: string;
                    author?: { login?: string } | null;
                    createdAt: string;
                    url?: string;
                  }[];
                };
              }[];
            };
          } | null;
        } | null;
      };
    };
    const pr = parsed.data?.repository?.pullRequest;
    if (!pr) return null;
    const requested = pr.reviewRequests?.nodes
      .map((n) => n.requestedReviewer?.login)
      .filter((x): x is string => !!x)[0];
    const latestReviews = pr.latestReviews?.nodes ?? [];
    const lastReviewer = latestReviews
      .slice()
      .sort((a, b) => (b.submittedAt > a.submittedAt ? 1 : -1))
      .map((n) => n.author?.login)
      .filter((x): x is string => !!x)[0];
    return {
      isOpen: pr.state === "OPEN",
      merged: pr.merged,
      approved: pr.reviewDecision === "APPROVED",
      threads: (pr.reviewThreads?.nodes ?? []).map((t) => ({
        isResolved: t.isResolved,
        ...(t.path ? { path: t.path } : {}),
        ...(t.line != null ? { line: t.line } : {}),
        comments: t.comments.nodes.map((c) => ({
          ...(c.author?.login ? { author: c.author.login } : {}),
          body: c.body,
          createdAt: c.createdAt,
          ...(c.url ? { url: c.url } : {}),
        })),
      })),
      ...(requested ? { requestedReviewer: requested } : {}),
      ...(lastReviewer ? { lastReviewer } : {}),
    };
  } catch (err) {
    onLog(`! gh graphql review-state failed for ${prUrl}: ${(err as Error).message}`, "yellow");
    return null;
  }
}

/** Post a single GitHub PR ping comment when Ralph has been waiting on
 *  a reviewer for >codeReviewStaleHours. Idempotent via prByPinged. */
export async function maybePingStaleReviewer(
  issue: LinearIssue,
  prUrl: string,
  state: PrReviewState,
  newestReviewerActivity: string,
  deps: ReviewScanDeps,
): Promise<void> {
  if (deps.staleHours <= 0) return;
  const reviewer = state.requestedReviewer ?? state.lastReviewer;
  if (!reviewer) return;
  const lastPinged = deps.stalePingedAt.get(prUrl);
  const now = Date.now();
  if (lastPinged && now - lastPinged < deps.staleHours * 3600_000) return;
  const elapsedH = newestReviewerActivity
    ? (now - Date.parse(newestReviewerActivity)) / 3600_000
    : Infinity;
  if (elapsedH < deps.staleHours) return;
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!m) return;
  const [, owner, repo, num] = m;
  const body = `🔔 @${reviewer} — Ralph has been waiting ${elapsedH.toFixed(0)}h on a re-review for ${prUrl}. Could you take another look when you have a moment?`;
  try {
    await deps.cmdRunner.run(
      ["gh", "api", `repos/${owner}/${repo}/issues/${num}/comments`, "-f", `body=${body}`],
      deps.projectRoot,
    );
    deps.stalePingedAt.set(prUrl, now);
    deps.onLog(`  ${issue.identifier}: pinged reviewer @${reviewer} on ${prUrl}`, "gray");
  } catch (err) {
    deps.onLog(`! reviewer ping failed for ${prUrl}: ${(err as Error).message}`, "yellow");
  }
}

/**
 * Inspect an open PR for unresolved review-thread comments. Returns a
 * `github-review` trigger if there is at least one reviewer comment
 * newer than Ralph's last `🔁 picked up` ack.
 */
export async function scanCodeReview(
  issue: LinearIssue,
  prUrl: string,
  lastRalphPickup: string | null,
  deps: ReviewScanDeps,
): Promise<MentionTrigger | null> {
  const state = await fetchPrReviewState(prUrl, deps.cmdRunner, deps.projectRoot, deps.onLog);
  if (!state || !state.isOpen || state.merged || state.approved) return null;
  const unresolved = state.threads.filter((t) => !t.isResolved && t.comments.length > 0);
  if (unresolved.length === 0) return null;
  const newestReviewerActivity = unresolved.reduce<string>((acc, t) => {
    const last = t.comments[t.comments.length - 1]!.createdAt;
    return last > acc ? last : acc;
  }, "");
  const changeName = changeNameForIssue(issue);
  const stateDir = await resolveReviewStateDir(changeName, {
    projectRoot: deps.projectRoot,
    useWorktree: deps.useWorktree,
    cwdOf: deps.cwdOf,
  });
  const persistedLastHandled = stateDir ? await readReviewWatermark(stateDir) : null;
  const memoLastHandled = deps.lastHandledReviewActivity.get(prUrl) ?? null;
  const lastHandled =
    persistedLastHandled && memoLastHandled
      ? persistedLastHandled > memoLastHandled
        ? persistedLastHandled
        : memoLastHandled
      : (persistedLastHandled ?? memoLastHandled);
  const effectiveLastHandled =
    lastRalphPickup && lastHandled
      ? lastRalphPickup > lastHandled
        ? lastRalphPickup
        : lastHandled
      : (lastRalphPickup ?? lastHandled);
  if (!effectiveLastHandled || newestReviewerActivity > effectiveLastHandled) {
    const body = unresolved
      .map((t) => {
        const head = t.path ? `_${t.path}${t.line ? `:${t.line}` : ""}_` : "_(general)_";
        const lines = t.comments.map(
          (c) =>
            `> **${c.author ?? "reviewer"}** (${c.createdAt})\n>\n> ${c.body.trim().replace(/\n/g, "\n> ")}`,
        );
        return [head, "", ...lines].join("\n");
      })
      .join("\n\n---\n\n");
    deps.lastHandledReviewActivity.set(prUrl, newestReviewerActivity);
    if (stateDir) {
      try {
        await writeField(
          stateDir,
          "review-followup",
          "review.lastConsumedCommentAt",
          newestReviewerActivity,
        );
      } catch (err) {
        deps.onLog(
          `! persist review.lastConsumedCommentAt for ${issue.identifier} failed: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    return {
      source: "github-review",
      body,
      createdAt: newestReviewerActivity || new Date().toISOString(),
      ...(state.lastReviewer ? { author: state.lastReviewer } : {}),
      url: prUrl,
    };
  }
  await maybePingStaleReviewer(issue, prUrl, state, newestReviewerActivity, deps);
  return null;
}
