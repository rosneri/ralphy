/**
 * The flag→option lookup and the typed assignment of each parsed value.
 *
 * `@ralphy/workflow/cli-options` declares WHICH config-backed flags exist and
 * what kind of token each takes; this module is the other half — the runtime
 * lookup (including the `--no-` twins of negatable booleans) and one setter per
 * `argKey` that writes the narrowed value onto the sparse overrides object.
 * `common-args.ts` owns the argv walk and calls in here.
 *
 * The `CliOverrides` import is type-only, so the pairing with `common-args.ts`
 * is a compile-time cycle, not a runtime one.
 */
import {
  COMMON_CLI_OPTIONS,
  effortOptionValues,
  modelOptionValues,
  negatedFlag,
  type CliOption,
} from "@ralphy/workflow/cli-options";
import type { CliOverrides } from "./common-args";

export const VALID_MODELS = new Set<string>(modelOptionValues());
const VALID_EFFORTS = new Set<string>(effortOptionValues());

// ─── Config-backed flags, derived from the shared catalogue ──────────────────

/** A flag token resolved back to its option plus the polarity it carries —
 *  `negated` is true only for the `--no-…` twin of a `negatableBoolean`. */
interface FlagMatch {
  option: CliOption;
  negated: boolean;
}

export const OPTION_BY_FLAG = new Map<string, FlagMatch>();
for (const option of COMMON_CLI_OPTIONS) {
  OPTION_BY_FLAG.set(option.flag, { option, negated: false });
  if (option.kind === "negatableBoolean") {
    OPTION_BY_FLAG.set(negatedFlag(option), { option, negated: true });
  }
}

export const VALUE_FLAGS = new Set<string>(
  COMMON_CLI_OPTIONS.filter(
    (option) => option.kind !== "boolean" && option.kind !== "negatableBoolean",
  ).map((option) => option.flag),
);

/** Typed assignment for each value-taking option, keyed by its `argKey`. */
type ValueSetter = (overrides: CliOverrides, raw: string) => void;
const VALUE_SETTERS: Record<string, ValueSetter> = {
  model: (overrides, raw) => {
    if (!VALID_MODELS.has(raw)) throw new Error("Invalid model");
    overrides.model = raw;
  },
  effort: (overrides, raw) => {
    if (!VALID_EFFORTS.has(raw)) throw new Error("Invalid effort");
    overrides.effort = raw;
  },
  delay: (overrides, raw) => {
    overrides.delay = parseInt(raw, 10);
  },
  maxCostUsd: (overrides, raw) => {
    overrides.maxCostUsd = parseFloat(raw);
  },
  maxRuntimeMinutes: (overrides, raw) => {
    overrides.maxRuntimeMinutes = parseFloat(raw);
  },
  maxConsecutiveFailures: (overrides, raw) => {
    overrides.maxConsecutiveFailures = parseInt(raw, 10);
  },
  maxIterations: (overrides, raw) => {
    overrides.maxIterations = parseInt(raw, 10);
  },
};

/** Typed assignment for each boolean option, keyed by its `argKey`. Bare
 *  `boolean` options are only ever called with `true`; `negatableBoolean`
 *  options receive the polarity of the token that matched. */
type BooleanSetter = (overrides: CliOverrides, value: boolean) => void;
const BOOLEAN_SETTERS: Record<string, BooleanSetter> = {
  log: (overrides) => {
    overrides.log = true;
  },
  verbose: (overrides) => {
    overrides.verbose = true;
  },
  manualTest: (overrides) => {
    overrides.manualTest = true;
  },
  tokenade: (overrides, value) => {
    overrides.tokenade = value;
  },
};

export function applyValueOption(option: CliOption, overrides: CliOverrides, raw: string): void {
  const setter = VALUE_SETTERS[option.argKey];
  // Invariant: every value-kind COMMON_CLI_OPTION must have a setter here.
  if (!setter) throw new Error("no value setter registered for CLI option");
  setter(overrides, raw);
}

export function applyBooleanOption(
  option: CliOption,
  overrides: CliOverrides,
  value: boolean,
): void {
  const setter = BOOLEAN_SETTERS[option.argKey];
  // Invariant: every boolean-kind COMMON_CLI_OPTION must have a setter here.
  if (!setter) throw new Error("no boolean setter registered for CLI option");
  setter(overrides, value);
}
