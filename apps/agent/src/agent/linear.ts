/**
 * Re-export shim — the Linear transport + ops live in
 * `../shared/capabilities/linear-client.ts` as of RLF-93 stage 4. This file
 * is kept so existing imports from `./linear` keep resolving while the
 * surrounding code is migrated to the new path.
 */

export type {
  LinearIssue,
  LinearFilterSpec,
  LinearComment,
  BlockerRef,
} from "../shared/capabilities/linear-client";
export {
  fetchMentionScanIssues,
  fetchOpenIssues,
  uploadFileToLinear,
  createAttachmentForUrl,
  deleteAttachment,
  addReactionToComment,
  addIssueComment,
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  fetchIssueComments,
  createRalphyAttachment,
  updateAttachmentSubtitle,
  upsertRalphyAttachment,
  fetchIssueAttachments,
  fetchAttachmentsForIssues,
  fetchBlockedByForIssues,
  findIssueAttachmentByTitle,
  fetchWorkflowStates,
  updateIssueState,
  fetchIssueLabels,
  fetchTeamIdByKey,
  createIssueLabel,
  addLabelToIssue,
  baseBranchFromLabels,
  issueMatchesGetIndicator,
  fetchProjectIdByName,
  setIssueProject,
  createIssue,
  updateIssueDescription,
  findOpenIssueByLabel,
  removeLabelFromIssue,
  linearRequestInternals,
  isRateLimitedError,
  formatLinearError,
} from "../shared/capabilities/linear-client";
