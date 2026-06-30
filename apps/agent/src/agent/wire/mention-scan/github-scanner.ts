import type { RalphyConfig } from "../../config";
import type { CmdRunner } from "../../pr";
import type { MentionTrigger } from "../../coordinator";
import { formatLinearError } from "../../../shared/capabilities/linear-client/request";
import type { TrackedIssue } from "@ralphy/tracker";
import { buildMentionAckComment } from "@ralphy/core/detections";
import {
  addGithubReactionToComment,
  fetchGithubIssueComments,
  postGithubIssueComment,
} from "../../../features/mention/github";
import {
  isRalphComment,
  containsHandle,
  findLastRalphPickupISO,
  findLastMentionAckISO,
} from "../task-bodies";
import { latestIso, isAlreadyReactedError } from "./shared";

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
  listOpenIssues: () => Promise<TrackedIssue[]>;
  /** Resolve the `owner/name` slug for the reactions / ack endpoints. */
  repo: () => Promise<string>;
}

/**
 * GitHub-tracker mention scanner (RLF-240). Sibling to
 * `createMentionScanner` for the Linear path: it lists open GitHub issues,
 * reads each issue's comments over REST (no Search-API), detects the first fresh
 * non-Ralph `@<handle>` mention, and emits a `MentionTrigger { source: "github" }`.
 * It shares the pure detection/gate/ack primitives with the Linear scanner.
 */
export function createGithubMentionScanner(input: GithubMentionScanInput): () => Promise<
  {
    issue: TrackedIssue;
    trigger: MentionTrigger;
  }[]
> {
  const { cfg, cmdRunner, projectRoot, onLog, diag, listOpenIssues, repo } = input;

  return async function fetchMentions(): Promise<
    { issue: TrackedIssue; trigger: MentionTrigger }[]
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

    let candidates: TrackedIssue[];
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

    const out: { issue: TrackedIssue; trigger: MentionTrigger }[] = [];
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
