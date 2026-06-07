/**
 * Shared wizard value types. Kept in a leaf module so both the builder
 * (`wizard.ts`) and the field catalogue (`fields.ts`) can import them without
 * forming an import cycle.
 */

import type { LinearFilter } from "@ralphy/types";

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

/** The global `linear.filter` value — the canonical `@ralphy/types` marker list. */
export type LinearFilterValue = LinearFilter;

export type WizardValue = string | number | boolean | string[] | IndicatorMap | LinearFilterValue;

export interface WizardAnswers {
  mode: SetupMode;
  /** Field-id keyed answers. Each id is a dotted path into the frontmatter. */
  values: Record<string, WizardValue>;
}
