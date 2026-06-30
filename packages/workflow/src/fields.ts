/**
 * Field catalogue for the customized setup walkthrough. Field ids are dotted
 * paths into the WORKFLOW.md frontmatter; the wizard stores answers keyed by id
 * and the builder writes each id straight to its path. `when` gates a field on a
 * prior answer so sub-options only appear when their section is enabled.
 *
 * `hint` is a short inline note about the input itself (e.g. "blank = all
 * teams"); `description` is a one- or two-sentence explanation of what the
 * setting does, written for someone new to Ralphy — it is shown under the
 * question AND pasted as a comment above the setting in the generated
 * WORKFLOW.md (a test keeps the two in sync). Migrations reference these ids.
 *
 * The individual field definitions live in the `fields/` modules; this file
 * keeps the public `Field` / `FieldSpec` types and the lookup/query functions.
 */
import type { WizardValue } from "./wizard-types";
import { CUSTOMIZED_FIELDS, HIDDEN_FIELD_IDS } from "./fields/customized-fields";
import { QUICK_FIELDS } from "./fields/quick-fields";
import { LINEAR_FILTER_DESCRIPTION } from "./fields/shared-fields";

export type FieldSpec =
  | { kind: "text"; placeholder?: string }
  | { kind: "number"; placeholder?: string }
  | { kind: "select"; options: { label: string; value: string }[] }
  | { kind: "multiselect"; options: { label: string; value: string }[] }
  | { kind: "list"; placeholder?: string }
  | { kind: "confirm"; defaultChoice: "confirm" | "cancel" }
  | { kind: "indicators" }
  | { kind: "multiline" };

export interface Field {
  id: string;
  label: string;
  /** Short inline note about the input (rendered next to the label). */
  hint?: string;
  /** One-line explanation of the setting (rendered under the question). */
  description?: string;
  emptyLabel?: string;
  spec: FieldSpec;
  /** Only ask this field when the predicate holds against current answers. */
  when?: (answers: Record<string, WizardValue>) => boolean;
}

/**
 * The fields to ask for a mode, filtered by their `when` predicate. When
 * `restrictTo` is given (the migration diff path), only fields whose id is in
 * that set are asked — their `when` gates still apply, so enabling a parent
 * toggle reveals its (also-restricted) children.
 */
export function fieldsForMode(
  mode: SetupModeLike,
  answers: Record<string, WizardValue> = {},
  restrictTo?: string[],
): Field[] {
  const all = mode === "customized" ? CUSTOMIZED_FIELDS : QUICK_FIELDS;
  const allowed = restrictTo ? new Set(restrictTo) : null;
  return all.filter((field) => {
    if (HIDDEN_FIELD_IDS.has(field.id)) return false;
    if (allowed && !allowed.has(field.id)) return false;
    return !field.when || field.when(answers);
  });
}

type SetupModeLike = "quick" | "permissive" | "customized";

/** Look up a catalogue field by its id (dotted config path). */
export function findField(id: string): Field | undefined {
  // Quick fields are a subset of the customized catalogue, so this covers both.
  return CUSTOMIZED_FIELDS.find((field) => field.id === id);
}

/**
 * Field descriptions keyed by frontmatter path — the single source for the
 * comment pasted above each setting in a generated WORKFLOW.md. The builder
 * stamps these onto live keys, so the wizard's on-screen help and the file's
 * inline docs never drift.
 */
export const FIELD_DESCRIPTIONS: { path: string[]; description: string }[] = [
  ...CUSTOMIZED_FIELDS.filter(
    (field): field is Field & { description: string } =>
      Boolean(field.description) && field.spec.kind !== "multiline",
  ).map((field) => ({ path: field.id.split("."), description: field.description })),
  // `linear.filter` is composed from the assignee select + specific-user value
  // (control fields, never asked directly), so its frontmatter comment is
  // stamped from here rather than from a walkthrough field.
  { path: ["linear", "filter"], description: LINEAR_FILTER_DESCRIPTION },
];
