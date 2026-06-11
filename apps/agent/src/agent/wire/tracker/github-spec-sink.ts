/**
 * GitHub comment sink for the living design document. Where Linear carries the
 * design as a single re-uploaded attachment, GitHub has no attachments API, so
 * the design markdown is embedded inside one marker-tagged "sticky" issue
 * comment (`type=spec`) that {@link upsertStickyComment} re-discovers and edits
 * in place across iterations.
 *
 * Best-effort throughout: every `gh` failure is swallowed by the underlying
 * helpers (a cosmetic design comment must never crash an iteration).
 */

import { basename, dirname } from "node:path";
import { buildRalphyComment, findStickyComment, RALPHY_TITLE_PREFIX } from "@ralphy/comms";
import { readSlotSidecar, writeField } from "@ralphy/core/state";
import type { CmdRunner } from "../../pr";
import { composeDesignDoc } from "../../linear-sync/spec-attachments";
import type { SpecSink } from "../../linear-sync/spec-sink";
import { upsertStickyComment } from "./sticky-comment";

/** GitHub rejects issue-comment bodies longer than this. We skip rather than
 *  attempt an upsert GitHub would reject. */
const GH_COMMENT_BODY_LIMIT = 65536;

interface GithubSpecSinkDeps {
  cmdRunner: CmdRunner;
  /** `owner/name`, or a resolver for it. A resolver lets `wire.ts` pass the
   *  GitHub provider's lazy `repo()` without awaiting at construction time. */
  repo: string | (() => Promise<string>);
  projectRoot: string;
  diag: (area: string, message: string, color?: string) => void;
}

interface SpecCommentJson {
  body: string;
}

/** Strip the unified title line and the trailing hidden marker from a sticky
 *  comment body, leaving just the embedded design markdown. */
function extractDesignFromComment(body: string): string {
  const lines = body.split("\n");
  if (lines[0]?.startsWith(RALPHY_TITLE_PREFIX)) lines.shift();
  return lines
    .filter((l) => !/<!--\s*ralphy:/.test(l))
    .join("\n")
    .trim();
}

export function createGithubSpecSink(deps: GithubSpecSinkDeps): SpecSink {
  const { cmdRunner, repo, projectRoot, diag } = deps;
  const resolveRepo = typeof repo === "string" ? async () => repo : repo;

  return {
    sync: async (ctx) => {
      const composed = await composeDesignDoc(ctx.changeDir, ctx.log);
      if (!composed) return;

      // Idempotency: skip the upsert when the composed content is unchanged
      // since the last sync (mirrors Linear's hash gate). The upsert is also
      // stateless-correct without this — the sidecar only suppresses a
      // redundant edit-in-place every iteration.
      const stateDir = dirname(ctx.statePath);
      let priorSha: string | null = null;
      try {
        const sidecar = await readSlotSidecar(stateDir, "specComment");
        const s = sidecar?.sha256;
        priorSha = typeof s === "string" ? s : null;
      } catch {
        /* treat as no prior hash */
      }
      if (priorSha === composed.sha256) {
        ctx.log(`  spec-comment: design unchanged, skipping`, "gray");
        return;
      }

      const body = buildRalphyComment({
        type: "spec",
        action: "design spec",
        body: composed.text,
        fields: { change: basename(ctx.changeDir) },
      });

      if (body.length > GH_COMMENT_BODY_LIMIT) {
        ctx.log(
          `! spec-comment: design exceeds GitHub's ${GH_COMMENT_BODY_LIMIT}-char comment limit (${body.length}), skipping`,
          "yellow",
        );
        return;
      }

      let repoSlug: string;
      try {
        repoSlug = await resolveRepo();
      } catch (err) {
        ctx.log(
          `! spec-comment: could not resolve repo (skipping): ${(err as Error).message}`,
          "yellow",
        );
        return;
      }

      await upsertStickyComment({
        cmdRunner,
        repo: repoSlug,
        projectRoot,
        issueNumber: ctx.issueId,
        type: "spec",
        body,
        diag,
      });

      try {
        await writeField(stateDir, "github-spec", "specComment.sha256", composed.sha256);
      } catch (err) {
        ctx.log(
          `! spec-comment: could not persist design hash (continuing): ${(err as Error).message}`,
          "yellow",
        );
      }
    },

    read: async ({ issueId }) => {
      let comments: SpecCommentJson[];
      try {
        const repoSlug = await resolveRepo();
        const { stdout } = await cmdRunner.run(
          ["gh", "issue", "view", issueId, "--repo", repoSlug, "--json", "comments"],
          projectRoot,
        );
        const parsed = JSON.parse(stdout.trim() || "{}") as { comments?: SpecCommentJson[] };
        comments = parsed.comments ?? [];
      } catch (err) {
        diag(
          "spec-comment",
          `! could not read design comment for issue #${issueId}: ${(err as Error).message}`,
          "yellow",
        );
        return null;
      }
      const existing = findStickyComment(comments, "spec");
      if (!existing) return null;
      const design = extractDesignFromComment(existing.body);
      return design.length > 0 ? design : null;
    },
  };
}
