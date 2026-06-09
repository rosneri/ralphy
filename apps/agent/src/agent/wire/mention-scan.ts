import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import type { AgentParsedArgs } from "../../cli";
import type { RalphyConfig } from "../config";
import type { CmdRunner } from "../pr";
import type { MentionTrigger } from "../coordinator";
import {
  fetchMentionScanIssues,
  addReactionToComment,
  createIssueComment,
  formatLinearError,
  isRateLimitedError,
  type LinearIssue,
} from "../linear";
import { buildMentionAckComment } from "@ralphy/core/detections";
import { changeNameForIssue } from "../scaffold";
import { scanCodeReview } from "../../features/review-followup/scan";
import {
  addGithubReactionToComment,
  fetchGithubIssueComments,
  fetchPrIssueComments,
  postGithubIssueComment,
  postGithubPrComment,
} from "../../features/mention/github";
import {
  isRalphComment,
  containsHandle,
  findLastRalphPickupISO,
  findLastMentionAckISO,
} from "./task-bodies";
import type { Indicators, LinearFilterScope } from "@ralphy/types";

/** Newest of a set of ISO timestamps (nulls ignored), or null when all null. */
function latestIso(...values: (string | null)[]): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (value && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

/** Linear/GitHub reject a duplicate reaction ("conflict on insert of Reaction"
 *  / "already exists"). That is not a failure — the comment is already marked
 *  seen — so the scan treats it as idempotent success instead of logging it
 *  every poll. */
function isAlreadyReactedError(err: unknown): boolean {
  const e = err as { messages?: string[]; message?: string };
  const text = [...(e?.messages ?? []), e?.message ?? ""].join(" ").toLowerCase();
  return (
    text.includes("conflict on insert of reaction") ||
    text.includes("already exists") ||
    text.includes("already reacted")
  );
}

interface MentionScanInput {
  apiKey: string;
  args: AgentParsedArgs;
  cfg: RalphyConfig;
  team: string | undefined;
  assignee: string | undefined;
  /** When true, scan regardless of assignee (`assignee = any`). */
  anyAssignee?: boolean | undefined;
  /** Global `linear.filter` label/project constraints, ANDed onto the mention scan. */
  scope: LinearFilterScope;
  /** RLF-208: when non-empty, constrain the mention scan to these ticket numbers. */
  ticketNumbers?: number[] | undefined;
  indicators: Indicators;
  projectRoot: string;
  useWorktree: boolean;
  cmdRunner: CmdRunner;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  cwdByChange: Map<string, string>;
  stalePingedAt: Map<string, number>;
  lastHandledReviewActivity: Map<string, string>;
  resolvePrUrlForIssue: (issue: LinearIssue) => Promise<string | null>;
}

export function createMentionScanner(input: MentionScanInput): () => Promise<
  {
    issue: LinearIssue;
    trigger: MentionTrigger;
  }[]
> {
  const {
    apiKey,
    args,
    cfg,
    team,
    assignee,
    anyAssignee,
    scope,
    indicators,
    projectRoot,
    useWorktree,
    cmdRunner,
    onLog,
    diag,
    cwdByChange,
    ticketNumbers,
    stalePingedAt,
    lastHandledReviewActivity,
    resolvePrUrlForIssue,
  } = input;

  return async function fetchMentions(): Promise<
    { issue: LinearIssue; trigger: MentionTrigger }[]
  > {
    const wantMention = cfg.linear.mentionTrigger;
    const wantCodeReview = args.codeReview || cfg.linear.codeReviewTrigger;
    if (!wantMention && !wantCodeReview) return [];
    const handle = cfg.linear.mentionHandle;
    let candidates: LinearIssue[] = [];
    try {
      candidates = await fetchMentionScanIssues(apiKey, {
        team,
        assignee,
        anyAssignee,
        ...scope,
        ...(ticketNumbers && ticketNumbers.length > 0 ? { numbers: ticketNumbers } : {}),
        indicators: {
          ...(indicators.getTodo !== undefined ? { getTodo: indicators.getTodo } : {}),
          ...(indicators.getInProgress !== undefined
            ? { getInProgress: indicators.getInProgress }
            : {}),
          ...(indicators.setDone !== undefined ? { setDone: indicators.setDone } : {}),
        },
      });
    } catch (err) {
      if (isRateLimitedError(err)) {
        diag(
          "mention",
          `! mention scan: rate limited, deferring rest of scan to next poll`,
          "yellow",
        );
        return [];
      }
      diag(
        "mention",
        `! mention scan: fetchMentionScanIssues failed: ${formatLinearError(err)}`,
        "yellow",
      );
      return [];
    }
    const out: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
    const queued = new Set<string>();
    let rateLimitedLogged = false;
    const logRateLimited = (): void => {
      if (rateLimitedLogged) return;
      rateLimitedLogged = true;
      diag(
        "mention",
        `! mention scan: rate limited, deferring rest of scan to next poll`,
        "yellow",
      );
    };
    for (const issue of candidates) {
      const comments = issue.comments ?? [];
      const lastRalphPickup = findLastRalphPickupISO(comments);
      // Gate fresh mentions on the newest of the review-pickup ack AND the
      // mention ack. The mention ack is what makes this self-suppressing: once
      // we answer a mention, its ack (newer than the mention) advances the
      // watermark, so the next poll skips it — regardless of whether the issue
      // is fresh, resuming, or in review. Without it, a mention on an
      // already-in-progress issue re-acks every poll (BAN-467).
      const linearMentionGate = latestIso(lastRalphPickup, findLastMentionAckISO(comments));

      if (wantMention) {
        for (const c of comments) {
          if (isRalphComment(c.body)) continue;
          if (!containsHandle(c.body, handle)) continue;
          if (linearMentionGate && c.createdAt <= linearMentionGate) continue;
          out.push({
            issue,
            trigger: {
              source: "linear",
              body: c.body,
              createdAt: c.createdAt,
              ...(c.user?.name ? { author: c.user.name } : {}),
              url: issue.url,
            },
          });
          try {
            await addReactionToComment(apiKey, c.id, "👀");
          } catch (err) {
            if (isRateLimitedError(err)) {
              logRateLimited();
              queued.add(issue.id);
              break;
            }
            if (!isAlreadyReactedError(err)) {
              diag(
                "mention",
                `! mention scan: Linear reaction failed for ${issue.identifier}: ${formatLinearError(err)}`,
                "yellow",
              );
            }
          }
          if (cfg.linear.postComments !== false) {
            try {
              // Posts only the hidden mention-ack marker — the visible ack is the
              // 👀 reaction above. The marker is the dedup watermark.
              await createIssueComment(apiKey, issue.id, buildMentionAckComment());
            } catch (err) {
              diag(
                "mention",
                `! mention scan: ack comment failed for ${issue.identifier}: ${formatLinearError(err)}`,
                "yellow",
              );
            }
          }
          queued.add(issue.id);
          break;
        }
        if (rateLimitedLogged) break;
        if (queued.has(issue.id)) continue;
      }

      // The GitHub-side mention/review scan needs the ticket's PR. Tickets
      // that have never been worked (unstarted/backlog/triage state types)
      // cannot have a PR — skip the per-issue GitHub search + Linear
      // attachments fetch entirely. The Linear-comment scan above still
      // catches fresh `@ralphy` mentions on those tickets.
      if (issue.state.type !== "started" && issue.state.type !== "completed") continue;

      const prUrl = await resolvePrUrlForIssue(issue);
      if (!prUrl) continue;

      if (wantMention) {
        const ghComments = await fetchPrIssueComments(cmdRunner, projectRoot, prUrl, onLog);
        const ghMentionGate = latestIso(lastRalphPickup, findLastMentionAckISO(ghComments));
        const prMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(prUrl);
        for (const c of ghComments) {
          if (isRalphComment(c.body)) continue;
          if (!containsHandle(c.body, handle)) continue;
          if (ghMentionGate && c.createdAt <= ghMentionGate) continue;
          out.push({
            issue,
            trigger: {
              source: "github",
              body: c.body,
              createdAt: c.createdAt,
              ...(c.author ? { author: c.author } : {}),
              url: c.url,
            },
          });
          if (prMatch) {
            const [, owner, repo] = prMatch;
            try {
              await addGithubReactionToComment(
                cmdRunner,
                projectRoot,
                { owner: owner!, repo: repo!, kind: "issue" },
                c.id,
                "👀",
              );
            } catch (err) {
              if (!isAlreadyReactedError(err)) {
                diag(
                  "mention",
                  `! mention scan: GitHub reaction failed for ${prUrl}: ${formatLinearError(err)}`,
                  "yellow",
                );
              }
            }
            if (cfg.linear.postComments !== false) {
              // Hidden mention-ack marker only — the visible ack is the 👀
              // reaction above. The marker is the dedup watermark.
              await postGithubPrComment(
                cmdRunner,
                projectRoot,
                prUrl,
                buildMentionAckComment(),
                onLog,
              );
            }
          }
          queued.add(issue.id);
          break;
        }
        if (queued.has(issue.id)) continue;
      }

      if (wantCodeReview) {
        const trigger = await scanCodeReview(issue, prUrl, lastRalphPickup, {
          cmdRunner,
          projectRoot,
          useWorktree,
          staleHours: cfg.linear.codeReviewStaleHours,
          cwdOf: (cn) => cwdByChange.get(cn),
          lastHandledReviewActivity,
          stalePingedAt,
          onLog,
        });
        if (trigger) {
          out.push({ issue, trigger });
          queued.add(issue.id);
        }
      }
    }
    return out;
  };
}

/** The resolved config slice the GitHub mention scanner reads. Narrowed from
 *  the full {@link RalphyConfig} so unit tests can build a plain literal without
 *  casting the whole config shape. */
type GithubMentionConfig = {
  linear: Pick<RalphyConfig["linear"], "mentionTrigger" | "mentionHandle" | "postComments">;
};

interface GithubMentionScanInput {
  cfg: GithubMentionConfig;
  cmdRunner: CmdRunner;
  projectRoot: string;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  /** List the open issues to scan (todo + in-progress, label-scoped; no
   *  Search-API). Injected from the GitHub tracker provider. */
  listOpenIssues: () => Promise<LinearIssue[]>;
  /** Resolve the `owner/name` slug for the reactions / ack endpoints. */
  repo: () => Promise<string>;
}

/**
 * GitHub-tracker mention scanner (RLF-240). Sibling to
 * {@link createMentionScanner} for the Linear path: it lists open GitHub issues,
 * reads each issue's comments over REST (no Search-API), detects the first fresh
 * non-Ralph `@<handle>` mention, and emits a `MentionTrigger { source: "github" }`.
 * It shares the pure detection/gate/ack primitives with the Linear scanner.
 */
export function createGithubMentionScanner(input: GithubMentionScanInput): () => Promise<
  {
    issue: LinearIssue;
    trigger: MentionTrigger;
  }[]
> {
  const { cfg, cmdRunner, projectRoot, onLog, diag, listOpenIssues, repo } = input;

  return async function fetchMentions(): Promise<
    { issue: LinearIssue; trigger: MentionTrigger }[]
  > {
    if (!cfg.linear.mentionTrigger) return [];
    const handle = cfg.linear.mentionHandle;

    let repoSlug: string;
    try {
      repoSlug = await repo();
    } catch (err) {
      diag("mention", `! github mention scan: ${(err as Error).message}`, "yellow");
      return [];
    }
    const [owner, name] = repoSlug.split("/");
    if (!owner || !name) {
      diag("mention", `! github mention scan: unexpected repo slug '${repoSlug}'`, "yellow");
      return [];
    }

    let candidates: LinearIssue[];
    try {
      candidates = await listOpenIssues();
    } catch (err) {
      diag(
        "mention",
        `! github mention scan: list issues failed: ${formatLinearError(err)}`,
        "yellow",
      );
      return [];
    }

    const out: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
    for (const issue of candidates) {
      const issueNumber = Number(issue.id);
      if (!Number.isFinite(issueNumber)) continue;
      const comments = await fetchGithubIssueComments(
        cmdRunner,
        projectRoot,
        repoSlug,
        issueNumber,
        onLog,
      );
      // Embed the fetched comments on the candidate so downstream consumers
      // (e.g. the re-engagement task builder) don't re-fetch.
      issue.comments = comments.map((c) => ({
        id: String(c.id),
        body: c.body,
        createdAt: c.createdAt,
        user: c.author ? { name: c.author, email: null } : null,
      }));
      // Gate fresh mentions on the newest of the review-pickup ack AND the
      // mention ack — once a mention is answered its ack (newer than the
      // mention) advances the watermark, so the next poll skips it.
      const gate = latestIso(findLastRalphPickupISO(comments), findLastMentionAckISO(comments));
      for (const c of comments) {
        if (isRalphComment(c.body)) continue;
        if (!containsHandle(c.body, handle)) continue;
        if (gate && c.createdAt <= gate) continue;
        out.push({
          issue,
          trigger: {
            source: "github",
            body: c.body,
            createdAt: c.createdAt,
            ...(c.author ? { author: c.author } : {}),
            url: c.url,
          },
        });
        try {
          await addGithubReactionToComment(
            cmdRunner,
            projectRoot,
            { owner, repo: name, kind: "issue" },
            c.id,
            "👀",
          );
        } catch (err) {
          if (!isAlreadyReactedError(err)) {
            diag(
              "mention",
              `! github mention scan: reaction failed for ${repoSlug}#${issueNumber}: ${formatLinearError(err)}`,
              "yellow",
            );
          }
        }
        if (cfg.linear.postComments !== false) {
          // Hidden mention-ack marker only — the visible ack is the 👀 reaction
          // above. The marker is the dedup watermark.
          await postGithubIssueComment(
            cmdRunner,
            projectRoot,
            repoSlug,
            issueNumber,
            buildMentionAckComment(),
            onLog,
          );
        }
        // Emit only the first un-acked mention per issue; later polls pick up
        // subsequent ones once the watermark advances.
        break;
      }
    }
    return out;
  };
}

export async function isChangeArchivedForIssue(
  issue: LinearIssue,
  cwdByChange: Map<string, string>,
  projectRoot: string,
): Promise<boolean> {
  const changeName = changeNameForIssue(issue);
  const root = cwdByChange.get(changeName) ?? projectRoot;
  const archiveDir = join(projectLayout(root).tasksDir, "archive");
  let entries: string[];
  try {
    entries = await readdir(archiveDir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return false;
    throw err;
  }
  const suffix = `-${changeName}`;
  return entries.some((name) => name === changeName || name.endsWith(suffix));
}
