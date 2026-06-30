import type { Field } from "@ralphy/workflow/fields";
import type { WizardValue } from "@ralphy/workflow/wizard-types";
import { optionsFor } from "./options";

export interface EditingState {
  draft: string;
  optionIndex: number;
  listItems: string[];
  selected: Set<string>;
}

export function computeEditing(
  field: Field,
  stored: WizardValue | undefined,
  multilineFallback = "",
): EditingState {
  const textLike = field.spec.kind === "text" || field.spec.kind === "number";
  return {
    draft:
      textLike && stored !== undefined
        ? String(stored)
        : field.spec.kind === "multiline"
          ? typeof stored === "string"
            ? stored
            : multilineFallback
          : "",
    optionIndex: initialOptionIndex(field, stored),
    listItems:
      field.spec.kind === "list" && Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === "string")
        : [],
    selected:
      field.spec.kind === "multiselect" && Array.isArray(stored)
        ? new Set(stored.filter((item): item is string => typeof item === "string"))
        : new Set(),
  };
}

export function initialOptionIndex(field: Field, stored: WizardValue | undefined): number {
  const options = optionsFor(field);
  if (field.spec.kind === "confirm") {
    if (stored === undefined) return field.spec.defaultChoice === "confirm" ? 0 : 1;
    return stored ? 0 : 1;
  }
  if (field.spec.kind === "indicators") {
    if (stored === undefined || stored === "none") return 0;
    if (typeof stored === "string") {
      const found = options.findIndex((o) => o.value === stored);
      return found < 0 ? 0 : found;
    }
    return options.findIndex((o) => o.value === "custom"); // a custom map
  }
  if (stored === undefined) return 0;
  const found = options.findIndex((o) => o.value === stored);
  return found < 0 ? 0 : found;
}

/** The {line, col} of a character offset within multi-line text. */
export function cursorLineCol(text: string, offset: number): { line: number; col: number } {
  const lines = text.split("\n");
  let remaining = offset;
  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line]!.length) return { line, col: remaining };
    remaining -= lines[line]!.length + 1;
  }
  const last = lines.length - 1;
  return { line: last, col: lines[last]!.length };
}

/** Move a cursor offset up (-1) or down (+1) one line, keeping the column. */
export function moveCursorVertically(text: string, offset: number, direction: -1 | 1): number {
  const lines = text.split("\n");
  const { line, col } = cursorLineCol(text, offset);
  const target = line + direction;
  if (target < 0 || target >= lines.length) return offset;
  let result = 0;
  for (let i = 0; i < target; i++) result += lines[i]!.length + 1;
  return result + Math.min(col, lines[target]!.length);
}
