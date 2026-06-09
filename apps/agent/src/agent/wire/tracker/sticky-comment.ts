import type { RalphyCommentType } from "@ralphy/comms";
import { findStickyComment } from "@ralphy/comms";
import type { CmdRunner } from "../../pr";

/**
 * Dependencies for {@link upsertStickyComment}. All IO flows through the
 * injected {@link CmdRunner}, so the helper is fully scriptable in tests.
 */
interface StickyUpsertDeps {
  cmdRunner: CmdRunner;
  /** `owner/name` to operate on. */
  repo: string;
  /** cwd for the `gh` invocations. */
  projectRoot: string;
  /** GitHub issue number (the `LinearIssue.id` in github mode). */
  issueNumber: string;
  /** Marker type the sticky comment carries; used to re-discover it. */
  type: RalphyCommentType;
  /** Full comment body, already including the hidden Ralphy marker. */
  body: string;
  diag: (area: string, message: string, color?: string) => void;
}

/** Shape of one entry in `gh issue view --json comments`. `id` is the GraphQL
 *  node id gh exposes for each comment, used by the edit-in-place mutation. */
interface GhComment {
  id?: string;
  body: string;
}

/** GraphQL mutation that edits an existing issue comment in place. Body and id
 *  travel as GraphQL variables (`-f`/`-F`), so markdown is never shell-quoted. */
export const UPDATE_COMMENT_MUTATION =
  "mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){clientMutationId}}";

/**
 * Upsert a single marker-tagged "sticky" comment on a GitHub issue: list the
 * issue's comments, find the one carrying the {@link StickyUpsertDeps.type}
 * marker, and edit it in place when present, else create it. This is the GitHub
 * substitute for Linear's single-attachment upsert — the hidden marker lets the
 * comment be re-discovered statelessly, so N applies converge on exactly one
 * comment carrying the latest body.
 *
 * Every `gh` failure is best-effort: it is logged yellow through `diag` and
 * swallowed, never thrown into the loop — a cosmetic sticky comment must not
 * crash an iteration.
 */
export async function upsertStickyComment(deps: StickyUpsertDeps): Promise<void> {
  const { cmdRunner, repo, projectRoot, issueNumber, type, body, diag } = deps;

  let comments: GhComment[];
  try {
    const { stdout } = await cmdRunner.run(
      ["gh", "issue", "view", issueNumber, "--repo", repo, "--json", "comments"],
      projectRoot,
    );
    const parsed = JSON.parse(stdout.trim() || "{}") as { comments?: GhComment[] };
    comments = parsed.comments ?? [];
  } catch (err) {
    diag(
      "sticky-comment",
      `! could not list comments for issue #${issueNumber}: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }

  const existing = findStickyComment(comments, type);

  try {
    if (existing?.id) {
      await cmdRunner.run(
        [
          "gh",
          "api",
          "graphql",
          "-f",
          `query=${UPDATE_COMMENT_MUTATION}`,
          "-f",
          `id=${existing.id}`,
          "-F",
          `body=${body}`,
        ],
        projectRoot,
      );
      diag("sticky-comment", `  → #${issueNumber} ${type} comment edited in place`, "gray");
      return;
    }
    await cmdRunner.run(
      ["gh", "issue", "comment", issueNumber, "--repo", repo, "--body", body],
      projectRoot,
    );
    diag("sticky-comment", `  → #${issueNumber} ${type} comment created`, "gray");
  } catch (err) {
    diag(
      "sticky-comment",
      `! could not upsert ${type} comment on issue #${issueNumber}: ${(err as Error).message}`,
      "yellow",
    );
  }
}
