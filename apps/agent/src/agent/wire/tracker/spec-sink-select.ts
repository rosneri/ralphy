/**
 * Select the design-doc {@link SpecSink} for a run by `tracker.kind` (RLF-239).
 * Linear publishes the design as a re-uploaded attachment; GitHub embeds it in
 * one sticky issue comment. Extracted from `wire.ts` to keep that file under
 * its size budget — the gate on `cfg.linear.syncSpecsAsAttachments` and the
 * Linear-only tasks-comment mirror still live in `createCommentSyncHooks`.
 */

import type { RalphyConfig } from "../../config";
import {
  uploadFileToLinear,
  createAttachmentForUrl,
  deleteAttachment,
  findIssueAttachmentByTitle,
} from "../../linear";
import { createLinearSpecSink, type SpecSink } from "../../linear-sync/spec-sink";
import type { CmdRunner } from "../../pr";
import { createGithubSpecSink } from "./github-spec-sink";

interface SelectSpecSinkInput {
  isGithubTracker: boolean;
  /** The GitHub provider's lazy repo resolver, when in github mode. */
  githubProvider: { repo: () => Promise<string> } | null;
  apiKey: string;
  cfg: RalphyConfig;
  cmdRunner: CmdRunner;
  projectRoot: string;
  diag: (area: string, message: string, color?: string) => void;
}

export function selectSpecSink(input: SelectSpecSinkInput): SpecSink | null {
  const { isGithubTracker, githubProvider, apiKey, cfg, cmdRunner, projectRoot, diag } = input;
  if (isGithubTracker) {
    if (!githubProvider) return null;
    return createGithubSpecSink({ cmdRunner, repo: githubProvider.repo, projectRoot, diag });
  }
  if (!apiKey) return null;
  return createLinearSpecSink({
    apiKey,
    mutations: {
      uploadFileToLinear,
      createAttachmentForUrl,
      deleteAttachment,
      findIssueAttachmentByTitle,
    },
    ...(cfg.linear.specAttachmentFormats ? { formats: cfg.linear.specAttachmentFormats } : {}),
    ...(cfg.linear.specAttachmentRevisions
      ? { sealedRevisionMode: cfg.linear.specAttachmentRevisions }
      : {}),
  });
}
