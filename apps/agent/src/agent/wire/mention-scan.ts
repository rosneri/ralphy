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
  fetchPrIssueComments,
  postGithubPrComment,
} from "../../features/mention/github";
import {
  isRalphComment,
  containsHandle,
  findLastRalphPickupISO,
  findLastMentionAckISO,
} from "./task-bodies";
import type { Indicators } from "@ralphy/types";

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
  /** Global `linear.filter` must-have labels, ANDed onto the mention scan. */
  requireAllLabels?: string[] | undefined;
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
    requireAllLabels,
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
        ...(requireAllLabels && requireAllLabels.length > 0 ? { requireAllLabels } : {}),
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
              await createIssueComment(
                apiKey,
                issue.id,
                buildMentionAckComment(c.body, c.user?.name),
              );
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
              await postGithubPrComment(
                cmdRunner,
                projectRoot,
                prUrl,
                buildMentionAckComment(c.body, c.author),
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
