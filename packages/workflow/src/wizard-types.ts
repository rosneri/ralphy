/**
 * Shared wizard value types. Kept in a leaf module so both the builder
 * (`wizard.ts`) and the field catalogue (`fields.ts`) can import them without
 * forming an import cycle.
 */

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
