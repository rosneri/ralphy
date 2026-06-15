import { resolve } from "node:path";
import type { Engine } from "@ralphy/types";
import type { WorkflowConfig } from "@ralphy/workflow";
import {
  COMMON_CLI_OPTIONS,
  effortOptionValues,
  modelOptionValues,
  type CliOption,
} from "@ralphy/workflow/cli-options";

/**
 * Common CLI flags shared by the loop / agent / task entrypoints.
 *
 * The parse result is SPARSE: `overrides` contains exactly the keys the user
 * passed on argv — no baked defaults, no `engineSet`-style sentinels. Presence
 * is the only signal of user intent; `@ralphy/config` merges these overrides
 * onto the WORKFLOW.md config with explicit `cli > workflow > default`
 * precedence. Any API that re-introduces pre-filled defaults into a parse
 * result is a regression.
 *
 * The set of config-backed flags (which flag exists, its value kind, and the
 * WORKFLOW.md field it maps to) is declared once in
 * `@ralphy/workflow/cli-options` and consumed here. This module owns only the
 * typed assignment of each parsed value and the bespoke flags that have no
 * config field (`--claude`/`--codex`, `--unlimited`, `--name`, `--prompt`, …).
 */

/**
 * Only keys the user explicitly passed on argv. `--claude [model]` /
 * `--codex` set `engine` (and optionally `model`); `--unlimited` sets
 * `maxIterations: 0` — an explicit zero, distinct from "not passed".
 */
export interface CliOverrides {
  engine?: Engine;
  model?: string;
  effort?: string;
  maxIterations?: number;
  maxCostUsd?: number;
  maxRuntimeMinutes?: number;
  maxConsecutiveFailures?: number;
  delay?: number;
  log?: boolean;
  verbose?: boolean;
  manualTest?: boolean;
}

/**
 * Sparse overrides for the agent-only config-backed flags — the loop has no
 * such flags, so they live in their own bag rather than polluting
 * `CliOverrides`. Same contract: presence is the only signal of user intent
 * (no sentinels), threaded through the same `mergeConfig` core with
 * `cli > workflow > default` precedence. `linearTeam` / `codeReview` both
 * target nested `linear.*` keys.
 */
export interface AgentOverrides {
  concurrency?: number;
  pollInterval?: number;
  linearTeam?: string;
  worktree?: boolean;
  createPr?: boolean;
  stackPrs?: boolean;
  codeReview?: boolean;
}

/**
 * Map from each agent override key to the WORKFLOW.md key it overrides. Both
 * `linearTeam` and `codeReview` map to `"linear"` — they set nested fields on
 * the same `linear` container (`linear.team`, `linear.codeReviewTrigger`), so
 * provenance is tracked at the `"linear"` top-level witness granularity.
 */
export const AGENT_OVERRIDE_TO_WORKFLOW_KEY = {
  concurrency: "concurrency",
  pollInterval: "pollIntervalSeconds",
  linearTeam: "linear",
  worktree: "useWorktree",
  createPr: "createPrOnSuccess",
  stackPrs: "stackPrsOnDependencies",
  codeReview: "linear",
} as const satisfies Record<keyof AgentOverrides, keyof WorkflowConfig>;

export const AGENT_OVERRIDE_KEYS: readonly (keyof AgentOverrides)[] = [
  "concurrency",
  "pollInterval",
  "linearTeam",
  "worktree",
  "createPr",
  "stackPrs",
  "codeReview",
];

/** Bespoke flags with no WORKFLOW.md counterpart — pass-through, never merged. */
export interface CliPassthrough {
  projectRoot?: string | undefined;
  /** Absolute path to an alternate WORKFLOW.md (`--workflow`). Resolved against
   *  `--project-root` when that flag is given, otherwise against cwd. */
  workflowFile?: string | undefined;
  /** Change name / ticket identifier (`--name`). */
  name: string;
  /** Task description (`--prompt`, or the contents read from `--prompt-file`). */
  prompt: string;
  /** Set when spawned by the agent app (`--from-agent`). */
  fromAgent: boolean;
  /** Recovery flow this worker was spawned for (`--trigger`). Set by the
   *  agent's fix-worker spawns only; config resolution uses it to pick the
   *  per-flow model/effort (`prRecovery.ciFix*` / `prRecovery.conflictFix*`). */
  trigger?: "ci-fix" | "conflict-fix";
}

export interface CommonArgs extends CliPassthrough {
  /** Sparse config overrides — exactly what argv set. */
  overrides: CliOverrides;
}

export function emptyCommonArgs(): CommonArgs {
  return {
    overrides: {},
    projectRoot: undefined,
    workflowFile: undefined,
    name: "",
    prompt: "",
    fromAgent: false,
  };
}

const VALID_MODELS = new Set<string>(modelOptionValues());
const VALID_EFFORTS = new Set<string>(effortOptionValues());

// ─── Config-backed flags, derived from the shared catalogue ──────────────────

const OPTION_BY_FLAG = new Map<string, CliOption>(
  COMMON_CLI_OPTIONS.map((option) => [option.flag, option]),
);
const VALUE_FLAGS = new Set<string>(
  COMMON_CLI_OPTIONS.filter((option) => option.kind !== "boolean").map((option) => option.flag),
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

/** Typed assignment for each bare boolean option, keyed by its `argKey`. */
type BooleanSetter = (overrides: CliOverrides) => void;
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
};

function applyValueOption(option: CliOption, args: CommonArgs, raw: string): void {
  const setter = VALUE_SETTERS[option.argKey];
  // Invariant: every value-kind COMMON_CLI_OPTION must have a setter here.
  if (!setter) throw new Error("no value setter registered for CLI option");
  setter(args.overrides, raw);
}

function applyBooleanOption(option: CliOption, args: CommonArgs): void {
  const setter = BOOLEAN_SETTERS[option.argKey];
  // Invariant: every boolean-kind COMMON_CLI_OPTION must have a setter here.
  if (!setter) throw new Error("no boolean setter registered for CLI option");
  setter(args.overrides);
}

/** True if `flag` is a common flag that expects a following value. */
export function isCommonExpectingFlag(flag: string): boolean {
  return (
    VALUE_FLAGS.has(flag) ||
    flag === "--project-root" ||
    flag === "--workflow" ||
    flag === "--claude" ||
    flag === "--trigger"
  );
}

/** True if `flag` is a common flag (boolean or value-taking). */
export function isCommonArg(flag: string): boolean {
  return (
    OPTION_BY_FLAG.has(flag) ||
    flag === "--project-root" ||
    flag === "--workflow" ||
    flag === "--claude" ||
    flag === "--codex" ||
    flag === "--unlimited" ||
    flag === "--trigger"
  );
}

export interface ParseState {
  /** A value-taking config flag was seen; the next token is its value. */
  pendingOption: CliOption | null;
  /** `--claude` accepts an optional trailing model (soft: skipped if not one). */
  expectClaudeModel: boolean;
  expectProjectRoot: boolean;
  expectWorkflow: boolean;
  expectName: boolean;
  expectPrompt: boolean;
  expectPromptFile: boolean;
  expectTrigger: boolean;
  /** Path captured from `--prompt-file`, resolved later by `resolvePromptFile`.
   *  null once a later `--prompt` overrides it (preserving last-wins order). */
  promptFilePath: string | null;
  /** Raw `--workflow` token, kept so `resolveWorkflowFile` can re-resolve it
   *  against `--project-root` after the whole argv is parsed (flags may appear
   *  in any order). null when `--workflow` was not given. */
  workflowFileRaw: string | null;
}

export function emptyParseState(): ParseState {
  return {
    pendingOption: null,
    expectClaudeModel: false,
    expectProjectRoot: false,
    expectWorkflow: false,
    expectName: false,
    expectPrompt: false,
    expectPromptFile: false,
    expectTrigger: false,
    promptFilePath: null,
    workflowFileRaw: null,
  };
}

function setEngine(overrides: CliOverrides, engine: Engine): void {
  if (overrides.engine !== undefined && overrides.engine !== engine) {
    throw new Error("Choose only one engine flag: --claude or --codex");
  }
  overrides.engine = engine;
}

/**
 * Try to handle one argv token as part of the common arg set.
 * Returns true when the token was consumed.
 *
 * Caller threads the same `state` across calls so multi-token flags
 * (e.g. `--max-iterations 10`) can pick up the value on the next call.
 */
export function parseCommonArg(arg: string, args: CommonArgs, state: ParseState): boolean {
  if (state.pendingOption) {
    applyValueOption(state.pendingOption, args, arg);
    state.pendingOption = null;
    return true;
  }
  if (state.expectClaudeModel) {
    state.expectClaudeModel = false;
    if (VALID_MODELS.has(arg)) {
      args.overrides.model = arg;
      return true;
    }
    // Token wasn't a model — fall through and let it be parsed normally.
  }
  if (state.expectProjectRoot) {
    args.projectRoot = arg;
    state.expectProjectRoot = false;
    return true;
  }
  if (state.expectWorkflow) {
    // Default to cwd-relative now; `resolveWorkflowFile` re-resolves against
    // `--project-root` after the parse if that flag was also given. Keeping a
    // value here means a caller that forgets the post-parse step degrades to
    // cwd-relative (today's behavior), never a dropped flag.
    state.workflowFileRaw = arg;
    args.workflowFile = resolve(arg);
    state.expectWorkflow = false;
    return true;
  }
  if (state.expectName) {
    args.name = arg;
    state.expectName = false;
    return true;
  }
  if (state.expectPrompt) {
    args.prompt = arg;
    // An inline --prompt value overrides any earlier --prompt-file path.
    state.promptFilePath = null;
    state.expectPrompt = false;
    return true;
  }
  if (state.expectPromptFile) {
    // Deferred: read the file in resolvePromptFile so this stays sync.
    state.promptFilePath = arg;
    state.expectPromptFile = false;
    return true;
  }
  if (state.expectTrigger) {
    state.expectTrigger = false;
    if (arg !== "ci-fix" && arg !== "conflict-fix") {
      throw new Error("Invalid --trigger (expected ci-fix or conflict-fix)");
    }
    args.trigger = arg;
    return true;
  }

  const option = OPTION_BY_FLAG.get(arg);
  if (option) {
    if (option.kind === "boolean") applyBooleanOption(option, args);
    else state.pendingOption = option;
    return true;
  }

  switch (arg) {
    case "--claude":
      setEngine(args.overrides, "claude");
      state.expectClaudeModel = true;
      return true;
    case "--codex":
      setEngine(args.overrides, "codex");
      return true;
    case "--unlimited":
      // An explicit "no limit" — recorded as a real override so it wins over
      // a WORKFLOW.md `maxIterationsPerTask`.
      args.overrides.maxIterations = 0;
      return true;
    case "--project-root":
      state.expectProjectRoot = true;
      return true;
    case "--workflow":
      state.expectWorkflow = true;
      return true;
    case "--name":
      state.expectName = true;
      return true;
    case "--prompt":
      state.expectPrompt = true;
      return true;
    case "--prompt-file":
      state.expectPromptFile = true;
      return true;
    case "--from-agent":
      args.fromAgent = true;
      return true;
    case "--trigger":
      state.expectTrigger = true;
      return true;
    default:
      return false;
  }
}

/**
 * Resolve a deferred `--prompt-file` path into `args.prompt`.
 *
 * `parseCommonArg` is synchronous, so it only records the file path; callers
 * invoke this once after the parse loop to perform the async file read. The
 * reader is injectable so `@ralphy/config` can route it through its
 * `ConfigFileSystem`.
 */
export async function resolvePromptFile(
  args: CommonArgs,
  state: ParseState,
  readText: (path: string) => Promise<string> = (path) => Bun.file(path).text(),
): Promise<void> {
  if (state.promptFilePath !== null) {
    args.prompt = await readText(state.promptFilePath);
  }
}

/**
 * Re-resolve a `--workflow` value against `--project-root` once the full argv is
 * parsed (the flags can appear in any order). Callers invoke this after the
 * parse loop. When `--project-root` was not given, the cwd-relative value set at
 * parse time stands — so an absolute `--workflow` is unaffected either way, and
 * a relative one tracks the project root the user pointed at.
 */
export function resolveWorkflowFile(args: CommonArgs, state: ParseState): void {
  if (state.workflowFileRaw !== null && args.projectRoot !== undefined) {
    args.workflowFile = resolve(args.projectRoot, state.workflowFileRaw);
  }
}

/**
 * Parse the full common arg set out of an argv slice, skipping unknown tokens
 * (an app's bespoke flags). Returns the sparse result plus the unconsumed
 * tokens, so callers can either parse the rest themselves or reject leftovers.
 */
export async function parseCommonArgv(
  argv: string[],
  readText?: (path: string) => Promise<string>,
): Promise<{ args: CommonArgs; rest: string[] }> {
  const args = emptyCommonArgs();
  const state = emptyParseState();
  const rest: string[] = [];
  for (const token of argv) {
    if (!parseCommonArg(token, args, state)) rest.push(token);
  }
  await resolvePromptFile(args, state, readText);
  resolveWorkflowFile(args, state);
  return { args, rest };
}

/**
 * Parse only the WORKFLOW.md path overrides (`--project-root`, `--workflow`)
 * from an argv slice, ignoring every other token. For entrypoints that need
 * the target file path without a full parse — e.g. `ralphy init` and the shell
 * first-run wizard hook — so they resolve the path identically to the loop /
 * agent / task CLIs (`--workflow` against `--project-root` when given, else cwd;
 * `--project-root` raw).
 */
export function parseWorkflowPathArgs(argv: string[]): {
  projectRoot: string | undefined;
  workflowFile: string | undefined;
} {
  const args = emptyCommonArgs();
  const state = emptyParseState();
  for (const token of argv) parseCommonArg(token, args, state);
  resolveWorkflowFile(args, state);
  return { projectRoot: args.projectRoot, workflowFile: args.workflowFile };
}
