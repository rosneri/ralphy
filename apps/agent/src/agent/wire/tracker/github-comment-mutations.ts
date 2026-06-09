/**
 * GitHub-backed {@link CommentMutations} for the shared comment-sync
 * orchestrators (plan-once + sticky tasks + steering refresh). Where Linear has
 * a real comment API keyed by node id, GitHub gets the marker-idempotent
 * "sticky upsert" pattern: list the issue's comments, re-discover the
 * marker-tagged one, and edit it in place — so N applies converge on exactly
 * one comment even when the persisted id was lost (wiped worktree / state).
 *
 * All IO flows through the injected {@link CmdRunner} with cwd = `projectRoot`
 * and `--repo` = `await repo()`, so the adapter is fully scriptable in tests.
 * The leading `apiKey` argument is part of the shared `CommentMutations`
 * signature; this adapter ignores it (auth flows through `gh`).
 */

import type { RalphyCommentType } from "@ralphy/comms";
import { findStickyComment, parseRalphyMarker } from "@ralphy/comms";
import type { CmdRunner } from "../../pr";
import type { CommentMutations } from "../../linear-sync/comment-sync";
import { UPDATE_COMMENT_MUTATION } from "./sticky-comment";

interface GithubCommentMutationsDeps {
  cmdRunner: CmdRunner;
  /** cwd for the `gh` invocations. */
  projectRoot: string;
  /** Resolves the `owner/name` slug to operate on (githubProvider.repo). */
  repo: () => Promise<string>;
  diag: (area: string, message: string, color?: string) => void;
}

/** Shape of one entry in `gh issue view --json comments`. `id` is the GraphQL
 *  node id gh exposes for each comment, used by the edit/delete mutations. */
interface GhComment {
  id?: string;
  body: string;
}

/** GraphQL mutation that deletes an issue comment by its node id. */
const DELETE_COMMENT_MUTATION =
  "mutation($id:ID!){deleteIssueComment(input:{id:$id}){clientMutationId}}";

export function createGithubCommentMutations(deps: GithubCommentMutationsDeps): CommentMutations {
  const { cmdRunner, projectRoot, repo, diag } = deps;

  async function listComments(issueNumber: string, r: string): Promise<GhComment[]> {
    const { stdout } = await cmdRunner.run(
      ["gh", "issue", "view", issueNumber, "--repo", r, "--json", "comments"],
      projectRoot,
    );
    const parsed = JSON.parse(stdout.trim() || "{}") as { comments?: GhComment[] };
    return parsed.comments ?? [];
  }

  async function editInPlace(id: string, body: string): Promise<void> {
    await cmdRunner.run(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${UPDATE_COMMENT_MUTATION}`,
        "-f",
        `id=${id}`,
        "-F",
        `body=${body}`,
      ],
      projectRoot,
    );
  }

  return {
    createIssueComment: async (_apiKey, issueNumber, body) => {
      const r = await repo();
      const type = parseRalphyMarker(body)?.type as RalphyCommentType | undefined;

      if (type) {
        const existing = findStickyComment(await listComments(issueNumber, r), type);
        if (existing?.id) {
          await editInPlace(existing.id, body);
          diag("comment-sync", `  → #${issueNumber} ${type} comment edited in place`, "gray");
          return existing.id;
        }
      }

      await cmdRunner.run(
        ["gh", "issue", "comment", issueNumber, "--repo", r, "--body", body],
        projectRoot,
      );
      // Re-list to resolve the freshly-created comment's node id.
      const created = type ? findStickyComment(await listComments(issueNumber, r), type) : null;
      if (!created?.id) {
        throw new Error("could not resolve created comment id", { cause: { issueNumber } });
      }
      diag("comment-sync", `  → #${issueNumber} ${type} comment created`, "gray");
      return created.id;
    },

    updateIssueComment: async (_apiKey, commentId, body) => {
      await editInPlace(commentId, body);
    },

    deleteIssueComment: async (_apiKey, commentId) => {
      await cmdRunner.run(
        ["gh", "api", "graphql", "-f", `query=${DELETE_COMMENT_MUTATION}`, "-f", `id=${commentId}`],
        projectRoot,
      );
    },
  };
}
