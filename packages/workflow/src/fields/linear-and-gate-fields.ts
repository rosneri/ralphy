import type { Field } from "../fields";
import { no, multiselectFromSchema, selectFromSchema, yes } from "./field-spec-builders";
import { isOn } from "./field-conditions";
import { PROMPT_BODY_FIELD_ID } from "./field-identifiers";

/**
 * Customized-walkthrough fields covering Linear comments / sync, the
 * confirmation gate, lifecycle indicators, advanced gates, and the prompt body.
 * The shared Linear fields (team, repo link, assignee) are spliced in ahead of
 * these by `customized-fields.ts`.
 */
export const LINEAR_AND_GATE_FIELDS: Field[] = [
  {
    id: "linear.postComments",
    label: "Post progress comments on the Linear issue?",
    description: "Post progress comments on the Linear issue while a task runs.",
    spec: yes(),
  },
  {
    id: "linear.updateEveryIterations",
    label: "Post a progress update every N iterations (0 = off)",
    description: "Post a progress comment every N loop iterations. 0 turns periodic updates off.",
    spec: { kind: "number", placeholder: "10" },
  },
  {
    id: "linear.mentionTrigger",
    label: "Watch comments/PRs for @mentions?",
    description:
      "Watch a finished issue's comments and its PR for @mentions of Ralphy, and re-engage when mentioned.",
    spec: yes(),
  },
  {
    id: "linear.mentionHandle",
    label: "Mention handle",
    description:
      "The @handle that, when mentioned, makes Ralphy pick the issue back up (e.g. @ralphy).",
    spec: { kind: "text", placeholder: "@ralphy" },
    when: isOn("linear.mentionTrigger"),
  },
  {
    id: "linear.codeReviewTrigger",
    label: "Watch PRs for unresolved review threads?",
    description: "Watch open PRs for unresolved review comments and re-engage to address them.",
    spec: yes(),
  },
  {
    id: "linear.codeReviewStaleHours",
    label: "Code-review stale window (hours)",
    description:
      "Ignore review comments older than this many hours, so stale threads don't re-trigger work.",
    spec: { kind: "number", placeholder: "24" },
    when: isOn("linear.codeReviewTrigger"),
  },
  {
    id: "linear.syncTasksToComment",
    label: "Sync tasks into a sticky Linear comment?",
    description:
      "Keep one pinned ('sticky') Linear comment in sync with the task checklist (tasks.md).",
    spec: yes(),
  },
  {
    id: "linear.syncSpecsAsAttachments",
    label: "Upload plan as attachments to the Linear ticket?",
    description:
      "Upload the OpenSpec planning docs (proposal.md, design.md) to the issue as attachments. OpenSpec is Ralphy's spec-driven planning format.",
    spec: yes(),
  },
  {
    id: "linear.specAttachmentFormats",
    label: "Plan attachment formats",
    description:
      "Which formats to upload the spec docs in: 'md' (raw markdown), 'pdf' (a rendered PDF), or both.",
    spec: multiselectFromSchema("linear.specAttachmentFormats"),
    when: isOn("linear.syncSpecsAsAttachments"),
  },
  // `linear.specAttachmentRevisions` is deliberately NOT a wizard field —
  // it is a config-file-only knob (defaults to "replace"); see schema.ts.

  // ── Confirmation mode ──
  {
    id: "linear.confirmationMode.enabled",
    label: "Enable the human confirmation gate?",
    description:
      "Pause after the agent finishes planning and wait for a human to approve before it writes any code (a confirmation gate).",
    spec: no(),
  },
  {
    id: "linear.confirmationMode.timeoutHours",
    label: "Confirmation timeout (hours)",
    description:
      "If no one approves or rejects within this many hours, auto-resolve the confirmation gate.",
    spec: { kind: "number", placeholder: "48" },
    when: isOn("linear.confirmationMode.enabled"),
  },
  {
    id: "linear.confirmationMode.maxConfirmationRounds",
    label: "Max confirmation rounds",
    description:
      "How many times the plan can be revised and re-submitted for approval before Ralphy gives up.",
    spec: { kind: "number", placeholder: "3" },
    when: isOn("linear.confirmationMode.enabled"),
  },

  // ── Linear indicators ──
  {
    id: "linear.indicators",
    label: "Linear lifecycle indicators",
    description:
      "How Ralphy maps lifecycle events to Linear statuses/labels — which issues to pick up (todo) and what to set when a task is in progress, done, or errored.",
    spec: { kind: "indicators" },
  },

  // ── Advanced gates ──
  {
    id: "preExistingErrorCheck.enabled",
    label: "Enable the base-branch health gate?",
    description:
      "Before picking up new work, run health-check commands on the base branch and pause if it's already broken, so the agent isn't blamed for pre-existing failures.",
    spec: no(),
  },
  {
    id: "preExistingErrorCheck.commands",
    label: "Health-gate commands (blank = use lint/test)",
    description:
      "Commands run against the base branch to judge its health. Leave empty to reuse your lint/test commands.",
    spec: { kind: "list", placeholder: "bun run lint" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.baseBranch",
    label: "Health-gate base branch",
    description: "The branch the health gate checks out and tests (usually main).",
    spec: { kind: "text", placeholder: "main" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.label",
    label: "Health-gate Linear label",
    description:
      "Linear label applied to the ticket Ralphy opens when the base branch is found broken.",
    spec: { kind: "text", placeholder: "ralph:pre-existing-error" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "metaPrompt.enabled",
    label: "Enable the meta-prompt addendum?",
    description:
      "Add Ralphy's task-level 'meta-prompt' layer (extra framing instructions) to each phase. Leave on unless you want raw prompts.",
    spec: yes(),
  },
  {
    id: "metaPrompt.effort",
    label: "Per-ticket effort tier",
    description:
      "How much effort the meta-prompt nudges the agent toward per ticket. 'auto' detects it from the ticket; 'light'/'standard'/'heavy' pin every ticket to that tier.",
    spec: selectFromSchema("metaPrompt.effort"),
    when: isOn("metaPrompt.enabled"),
  },
  {
    id: "openspec.reviewPhase.enabled",
    label: "Enable the OpenSpec review phase?",
    description:
      "After all tasks finish, spawn a separate reviewer agent that reads the full diff and writes review findings; open findings loop back into more work.",
    spec: no(),
  },
  {
    id: "openspec.reviewPhase.maxRounds",
    label: "Review phase max rounds",
    description: "How many review→fix cycles to run before the change is archived regardless.",
    spec: { kind: "number", placeholder: "1" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerModel",
    label: "Reviewer model (blank = same as main)",
    description:
      "Model used for the review pass. Blank reuses the main model; a cheaper tier (e.g. haiku) saves cost.",
    spec: { kind: "text", placeholder: "haiku" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerContextStrategy",
    label: "Reviewer context",
    description:
      "'fresh' gives the reviewer a brand-new session (unbiased); 'warm' resumes the last task's session (more context, cheaper).",
    spec: selectFromSchema("openspec.reviewPhase.reviewerContextStrategy"),
    when: isOn("openspec.reviewPhase.enabled"),
  },

  // ── Prompt body (the template sent to the agent) ──
  {
    id: PROMPT_BODY_FIELD_ID,
    label: "Customize the prompt sent to the agent?",
    description:
      "The prompt the agent receives lives in the file body — a template filled with per-issue values (e.g. {{ issue.identifier }}). Edit it here, or leave it and finish to keep the default.",
    spec: { kind: "multiline" },
  },
];
