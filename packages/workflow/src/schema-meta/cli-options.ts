/**
 * The config-backed common CLI flags, keyed by their WORKFLOW.md schema path.
 *
 * This is runtime-surface metadata, not wizard metadata: `@ralphy/cli-args`
 * derives its parser from this table, and the wizard's field catalogue
 * (`fields.ts`) is checked against the same schema paths by the invariant
 * test — so the CLI and the wizard both hang off the schema without either
 * importing the other.
 */
import { enumValuesAt, schemaHasPath } from "./introspect";

/** How a CLI flag's following token is parsed (or that it is a bare boolean). */
export type CliValueKind = "int" | "float" | "model" | "boolean";

/**
 * A CLI flag that overrides a WORKFLOW.md setting. `fieldId` is the dotted
 * schema path of the setting; `argKey` is the property set on the parsed
 * sparse-overrides object — its name intentionally differs from the config
 * path (e.g. `--max-iterations` → field `maxIterationsPerTask` →
 * `overrides.maxIterations`). Engine selection (`--claude`/`--codex`),
 * `--unlimited`, and the non-config flags (`--name`, `--prompt`, …) stay
 * bespoke in the parser.
 */
export interface CliOption {
  fieldId: string;
  flag: string;
  argKey: string;
  kind: CliValueKind;
}

export const COMMON_CLI_OPTIONS: CliOption[] = [
  { fieldId: "model", flag: "--model", argKey: "model", kind: "model" },
  { fieldId: "iterationDelaySeconds", flag: "--delay", argKey: "delay", kind: "int" },
  { fieldId: "maxCostUsdPerTask", flag: "--max-cost", argKey: "maxCostUsd", kind: "float" },
  {
    fieldId: "maxRuntimeMinutesPerTask",
    flag: "--max-runtime",
    argKey: "maxRuntimeMinutes",
    kind: "float",
  },
  {
    fieldId: "maxConsecutiveFailuresPerTask",
    flag: "--max-failures",
    argKey: "maxConsecutiveFailures",
    kind: "int",
  },
  {
    fieldId: "maxIterationsPerTask",
    flag: "--max-iterations",
    argKey: "maxIterations",
    kind: "int",
  },
  { fieldId: "logRawStream", flag: "--log", argKey: "log", kind: "boolean" },
  { fieldId: "taskVerbose", flag: "--verbose", argKey: "verbose", kind: "boolean" },
  { fieldId: "enableManualTest", flag: "--manual-test", argKey: "manualTest", kind: "boolean" },
];

/** Valid model values, sourced from the schema's `model` enum. */
export function modelOptionValues(): string[] {
  return enumValuesAt(["model"]) ?? [];
}

/** Whether a CLI option's fieldId resolves to a real schema path. */
export function cliOptionFieldExists(option: CliOption): boolean {
  return schemaHasPath(option.fieldId.split("."));
}
