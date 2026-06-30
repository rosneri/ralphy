import type { Field } from "../fields";
import {
  LINEAR_ASSIGNEE_CHOICE,
  LINEAR_ASSIGNEE_VALUE,
  LINEAR_TEAM,
  PROJECT_NAME,
  REPO_LINK,
} from "./shared-fields";
import { PROJECT_AND_EXECUTION_FIELDS } from "./project-and-execution-fields";
import { WORKTREE_AND_PULL_REQUEST_FIELDS } from "./worktree-and-pull-request-fields";
import { LINEAR_AND_GATE_FIELDS } from "./linear-and-gate-fields";

/**
 * Catalogue field ids that are kept (for CLI flags, frontmatter comments, and
 * migrations) but never asked in the setup walkthrough — their schema default
 * is taken instead. Filtered out of every mode by `fieldsForMode`.
 */
export const HIDDEN_FIELD_IDS = new Set<string>([
  "appendPrompt",
  "metaPrompt.enabled",
  "metaPrompt.effort",
  "logRawStream",
  "maxConsecutiveFailuresPerTask",
  "prDraft",
  "manualMergeWhenAutoMergeDisabled",
  "finalizeNoOpAsDone",
  "linear.confirmationMode.maxConfirmationRounds",
  "openspec.reviewPhase.enabled",
]);

export const CUSTOMIZED_FIELDS: Field[] = [
  // ── Project ──
  PROJECT_NAME,
  ...PROJECT_AND_EXECUTION_FIELDS,
  ...WORKTREE_AND_PULL_REQUEST_FIELDS,

  // ── Linear team / comments / sync ──
  LINEAR_TEAM,
  REPO_LINK,
  LINEAR_ASSIGNEE_CHOICE,
  LINEAR_ASSIGNEE_VALUE,
  ...LINEAR_AND_GATE_FIELDS,
];
