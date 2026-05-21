import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import type { ParsedArgs } from "../../cli";
import type { RalphyConfig } from "../config";
import type { CmdRunner } from "../pr";
import type { MentionTrigger } from "../coordinator";
import {
  fetchMentionScanIssues,
  addReactionToComment,
  formatLinearError,
  isRateLimitedError,
  type LinearIssue,
} from "../linear";
import { changeNameForIssue } from "../scaffold";
import { scanCodeReview } from "../../features/review-followup/scan";
import { addGithubReactionToComment, fetchPrIssueComments } from "../../features/mention/github";
import { isRalphComment, containsHandle, findLastRalphPickupISO } from "./task-bodies";
import type { Indicators } from "@ralphy/types";

export interface MentionScanInput {
  apiKey: string;
  args: ParsedArgs;
  cfg: RalphyConfig;
  team: string | undefined;
  assignee: string | undefined;
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
    indicators,
    projectRoot,
    useWorktree,
    cmdRunner,
    onLog,
    diag,
    cwdByChange,
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

      if (wantMention) {
        for (const c of comments) {
          if (isRalphComment(c.body)) continue;
          if (!containsHandle(c.body, handle)) continue;
          if (lastRalphPickup && c.createdAt <= lastRalphPickup) continue;
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
            diag(
              "mention",
              `! mention scan: Linear reaction failed for ${issue.identifier}: ${formatLinearError(err)}`,
              "yellow",
            );
          }
          queued.add(issue.id);
          break;
        }
        if (rateLimitedLogged) break;
        if (queued.has(issue.id)) continue;
      }

      const prUrl = await resolvePrUrlForIssue(issue);
      if (!prUrl) continue;

      if (wantMention) {
        const ghComments = await fetchPrIssueComments(cmdRunner, projectRoot, prUrl, onLog);
        const prMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(prUrl);
        for (const c of ghComments) {
          if (!containsHandle(c.body, handle)) continue;
          if (lastRalphPickup && c.createdAt <= lastRalphPickup) continue;
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
              diag(
                "mention",
                `! mention scan: GitHub reaction failed for ${prUrl}: ${formatLinearError(err)}`,
                "yellow",
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
