/**
 * Pure builders for the setup wizard (`ralphy init`).
 *
 * The wizard collects a flat map of `fieldId -> value` (field ids are dotted
 * paths into the WORKFLOW.md frontmatter, e.g. `linear.confirmationMode.enabled`).
 * Building is uniform: parse a base WORKFLOW.md into a YAML Document, `setIn`
 * every answered value at its path, and re-emit. Comments and formatting in the
 * base survive the round-trip (`flowCollectionPadding: false` keeps it
 * byte-identical when nothing is changed), so generating from the default
 * template preserves all of its guidance and editing preserves the user's file.
 */

import YAML from "yaml";
import { DEFAULT_WORKFLOW_MD } from "./default";
import { CURRENT_WORKFLOW_VERSION } from "./schema";
import { FRONTMATTER_RE } from "./workflow";

export type SetupMode = "quick" | "permissive" | "customized";

/** Curated Linear indicator templates offered by the wizard. */
export type IndicatorPreset = "none" | "status-standard" | "label-standard";

export interface IndicatorMarker {
  type: "status" | "label" | "project" | "attachment" | "comment";
  value: string;
  group?: string;
}
/** A built `linear.indicators` map: get-slots hold `{filter}`, set/clear-slots hold markers. */
export type IndicatorMap = Record<
  string,
  { filter: IndicatorMarker[] } | IndicatorMarker | IndicatorMarker[]
>;

export type WizardValue = string | number | boolean | string[] | IndicatorMap;

export interface WizardAnswers {
  mode: SetupMode;
  /** Field-id keyed answers. Each id is a dotted path into the frontmatter. */
  values: Record<string, WizardValue>;
}

export function indicatorsForPreset(preset: Exclude<IndicatorPreset, "none">): IndicatorMap {
  if (preset === "status-standard") {
    return {
      getTodo: { filter: [{ type: "status", value: "Todo" }] },
      getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "In Review" },
      setError: { type: "label", value: "ralph:error" },
    };
  }
  // label-standard
  return {
    getTodo: { filter: [{ type: "label", value: "ralph:todo" }] },
    setInProgress: { type: "label", value: "ralph:in-progress" },
    setDone: { type: "label", value: "ralph:done" },
    setError: { type: "label", value: "ralph:error" },
  };
}

/** Permissive mode turns on the "just let it run" flags on top of the answers. */
function withPresets(answers: WizardAnswers): Record<string, WizardValue> {
  const values: Record<string, WizardValue> = { ...answers.values };
  if (answers.mode === "permissive") {
    values["createPrOnSuccess"] = true;
    values["fixCiOnFailure"] = true;
    values["manualMergeWhenAutoMergeDisabled"] = false;
  }
  return values;
}

/** Parse `markdown`, set every answered value at its dotted path, re-emit. */
function applyToMarkdown(markdown: string, values: Record<string, WizardValue>): string {
  const m = FRONTMATTER_RE.exec(markdown);
  if (!m) {
    throw new Error("setup wizard: WORKFLOW.md is missing its YAML frontmatter block");
  }
  const doc = YAML.parseDocument(m[1] ?? "");
  for (const [id, value] of Object.entries(values)) {
    doc.setIn(id.split("."), value);
  }
  // Always stamp the current schema version so every written/migrated file is
  // marked. On the default template this key already holds the current value,
  // so the round-trip stays byte-identical; on a legacy file it adds the key.
  doc.setIn(["version"], CURRENT_WORKFLOW_VERSION);
  const body = m[2] ?? "";
  const frontmatter = doc.toString({ flowCollectionPadding: false }).replace(/\n+$/, "");
  return `---\n${frontmatter}\n---\n${body}`;
}

/**
 * Build a WORKFLOW.md from wizard answers, starting from the canonical default
 * template. Keeps all of the template's comments/formatting; with no answers in
 * quick mode the output is byte-identical to the default.
 */
export function buildWorkflowMarkdown(answers: WizardAnswers): string {
  return applyToMarkdown(DEFAULT_WORKFLOW_MD, withPresets(answers));
}

/**
 * Apply wizard answers onto an EXISTING WORKFLOW.md, preserving everything the
 * answers do not touch (custom rules, existing indicators, comments, body).
 */
export function applyAnswersToWorkflow(existing: string, answers: WizardAnswers): string {
  return applyToMarkdown(existing, answers.values);
}
