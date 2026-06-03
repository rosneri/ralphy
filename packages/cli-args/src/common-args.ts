import { resolve } from "node:path";
import type { Engine } from "@ralphy/types";
import { COMMON_CLI_OPTIONS, modelOptionValues, type CliOption } from "@ralphy/workflow/fields";

/**
 * Common CLI flags shared by the loop / agent / task entrypoints.
 *
 * The set of config-backed flags (which flag exists, its value kind, and the
 * WORKFLOW.md field it maps to) is declared once in `@ralphy/workflow/fields`
 * as `COMMON_CLI_OPTIONS` and consumed here — so the wizard and the CLI never
 * drift. This module owns only the CommonArgs-specific concerns: the typed
 * assignment of each parsed value and the bespoke flags that have no config
 * field (`--claude`/`--codex`, `--unlimited`, `--name`, `--prompt`, …).
 */

const VALID_MODELS = new Set<string>(modelOptionValues());

export interface CommonArgs {
  engine: Engine;
  model: string;
  engineSet: boolean;
  maxIterations: number;
  maxCostUsd: number;
  maxRuntimeMinutes: number;
  maxConsecutiveFailures: number;
  delay: number;
  log: boolean;
  verbose: boolean;
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
}

export function initialCommonArgs(): CommonArgs {
  return {
    engine: "claude",
    model: "opus",
    engineSet: false,
    maxIterations: 0,
    maxCostUsd: 0,
    maxRuntimeMinutes: 0,
    maxConsecutiveFailures: 5,
    delay: 0,
    log: false,
    verbose: false,
    projectRoot: undefined,
    workflowFile: undefined,
    name: "",
    prompt: "",
    fromAgent: false,
  };
}

// ─── Config-backed flags, derived from the shared catalogue ──────────────────

const OPTION_BY_FLAG = new Map<string, CliOption>(
  COMMON_CLI_OPTIONS.map((option) => [option.flag, option]),
);
const VALUE_FLAGS = new Set<string>(
  COMMON_CLI_OPTIONS.filter((option) => option.kind !== "boolean").map((option) => option.flag),
);

/** Typed assignment for each value-taking option, keyed by its `argKey`. */
type ValueSetter = (args: CommonArgs, raw: string) => void;
const VALUE_SETTERS: Record<string, ValueSetter> = {
  model: (args, raw) => {
    if (!VALID_MODELS.has(raw)) throw new Error("Invalid model");
    args.model = raw;
  },
  delay: (args, raw) => {
    args.delay = parseInt(raw, 10);
  },
  maxCostUsd: (args, raw) => {
    args.maxCostUsd = parseFloat(raw);
  },
  maxRuntimeMinutes: (args, raw) => {
    args.maxRuntimeMinutes = parseFloat(raw);
  },
  maxConsecutiveFailures: (args, raw) => {
    args.maxConsecutiveFailures = parseInt(raw, 10);
  },
  maxIterations: (args, raw) => {
    args.maxIterations = parseInt(raw, 10);
  },
};

/** Typed assignment for each bare boolean option, keyed by its `argKey`. */
type BooleanSetter = (args: CommonArgs) => void;
const BOOLEAN_SETTERS: Record<string, BooleanSetter> = {
  log: (args) => {
    args.log = true;
  },
  verbose: (args) => {
    args.verbose = true;
  },
};

function applyValueOption(option: CliOption, args: CommonArgs, raw: string): void {
  const setter = VALUE_SETTERS[option.argKey];
  // Invariant: every value-kind COMMON_CLI_OPTION must have a setter here.
  if (!setter) throw new Error("no value setter registered for CLI option");
  setter(args, raw);
}

function applyBooleanOption(option: CliOption, args: CommonArgs): void {
  const setter = BOOLEAN_SETTERS[option.argKey];
  // Invariant: every boolean-kind COMMON_CLI_OPTION must have a setter here.
  if (!setter) throw new Error("no boolean setter registered for CLI option");
  setter(args);
}

/** True if `flag` is a common flag that expects a following value. */
export function isCommonExpectingFlag(flag: string): boolean {
  return (
    VALUE_FLAGS.has(flag) ||
    flag === "--project-root" ||
    flag === "--workflow" ||
    flag === "--claude"
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
    flag === "--unlimited"
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
    promptFilePath: null,
    workflowFileRaw: null,
  };
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
      args.model = arg;
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

  const option = OPTION_BY_FLAG.get(arg);
  if (option) {
    if (option.kind === "boolean") applyBooleanOption(option, args);
    else state.pendingOption = option;
    return true;
  }

  switch (arg) {
    case "--claude":
      if (args.engineSet && args.engine !== "claude") {
        throw new Error("Choose only one engine flag: --claude or --codex");
      }
      args.engine = "claude";
      args.engineSet = true;
      state.expectClaudeModel = true;
      return true;
    case "--codex":
      if (args.engineSet && args.engine !== "codex") {
        throw new Error("Choose only one engine flag: --claude or --codex");
      }
      args.engine = "codex";
      args.engineSet = true;
      return true;
    case "--unlimited":
      args.maxIterations = 0;
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
    default:
      return false;
  }
}

/**
 * Resolve a deferred `--prompt-file` path into `args.prompt`.
 *
 * `parseCommonArg` is synchronous, so it only records the file path; callers
 * invoke this once after the parse loop to perform the async file read.
 */
export async function resolvePromptFile(args: CommonArgs, state: ParseState): Promise<void> {
  if (state.promptFilePath !== null) {
    args.prompt = await Bun.file(state.promptFilePath).text();
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
  const args = initialCommonArgs();
  const state = emptyParseState();
  for (const token of argv) parseCommonArg(token, args, state);
  resolveWorkflowFile(args, state);
  return { projectRoot: args.projectRoot, workflowFile: args.workflowFile };
}
