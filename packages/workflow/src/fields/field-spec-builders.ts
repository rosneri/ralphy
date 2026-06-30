import type { FieldSpec } from "../fields";
import { enumValuesAt } from "../schema-meta/introspect";

export const yes = (): FieldSpec => ({ kind: "confirm", defaultChoice: "confirm" });
export const no = (): FieldSpec => ({ kind: "confirm", defaultChoice: "cancel" });

/**
 * Build a select/multiselect spec whose options come from the schema's enum at
 * the field's own config path — the schema is the single source of truth for
 * which values exist; the catalogue only overlays display labels when they
 * differ from the raw value. Throws at module load if the path is not
 * enum-backed, so a renamed schema key fails fast rather than rendering an
 * empty select.
 */
export function selectFromSchema(fieldId: string, labels: Record<string, string> = {}): FieldSpec {
  return { kind: "select", options: enumOptions(fieldId, labels) };
}

export function multiselectFromSchema(
  fieldId: string,
  labels: Record<string, string> = {},
): FieldSpec {
  return { kind: "multiselect", options: enumOptions(fieldId, labels) };
}

function enumOptions(
  fieldId: string,
  labels: Record<string, string>,
): { label: string; value: string }[] {
  const values = enumValuesAt(fieldId.split("."));
  if (!values || values.length === 0) {
    const err = new Error("field is not backed by a schema enum") as Error & { fieldId?: string };
    err.fieldId = fieldId;
    throw err;
  }
  return values.map((value) => ({ label: labels[value] ?? value, value }));
}
