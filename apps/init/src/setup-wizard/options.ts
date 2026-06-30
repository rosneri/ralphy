import type { Field } from "@ralphy/workflow/fields";
import type { WizardValue } from "@ralphy/workflow/wizard-types";

/** Answers are keyed by field id (a dotted frontmatter path). */
export type Answers = Record<string, WizardValue>;

export interface Option {
  label: string;
  value: string;
}

export const REPO_ANSWER_IDS = ["repo.remote", "repo.host", "repo.owner", "repo.name"] as const;

export const MODE_OPTIONS: Option[] = [
  { label: "Quick — sensible defaults, only a few questions", value: "quick" },
  { label: "Permissive — defaults + auto-PR / auto-merge / CI auto-fix", value: "permissive" },
  { label: "Customized — walk through every setting group", value: "customized" },
];

export const INDICATOR_OPTIONS: Option[] = [
  { label: "None — configure later in WORKFLOW.md", value: "none" },
  { label: "Status-based preset (Todo → In Progress → In Review)", value: "status-standard" },
  { label: "Label-based preset (ralph:todo / in-progress / done)", value: "label-standard" },
  { label: "Custom — open a guided builder (enter opens it)", value: "custom" },
];

export const CONFIRM_OPTIONS: Option[] = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
];

export function optionsFor(field: Field): Option[] {
  if (field.spec.kind === "select" || field.spec.kind === "multiselect") return field.spec.options;
  if (field.spec.kind === "indicators") return INDICATOR_OPTIONS;
  return CONFIRM_OPTIONS;
}
