import type { Engine } from "@ralphy/types";

const VALID_MODELS = new Set<string>(["haiku", "sonnet", "opus"]);

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
  };
}

const FLAGS_WITH_VALUE = new Set<string>([
  "--model",
  "--delay",
  "--max-cost",
  "--max-runtime",
  "--max-failures",
  "--max-iterations",
  "--project-root",
]);

const BOOLEAN_FLAGS = new Set<string>(["--codex", "--unlimited", "--log", "--verbose"]);

/** True if `flag` is a common flag that expects a following value. */
export function isCommonExpectingFlag(flag: string): boolean {
  return FLAGS_WITH_VALUE.has(flag) || flag === "--claude";
}

/** True if `flag` is a common flag (boolean or value-taking). */
export function isCommonArg(flag: string): boolean {
  return BOOLEAN_FLAGS.has(flag) || FLAGS_WITH_VALUE.has(flag) || flag === "--claude";
}

export interface ParseState {
  expectModel: boolean;
  expectModelFlag: boolean;
  expectDelay: boolean;
  expectMaxCost: boolean;
  expectMaxRuntime: boolean;
  expectMaxFailures: boolean;
  expectMaxIterations: boolean;
  expectProjectRoot: boolean;
}

export function emptyParseState(): ParseState {
  return {
    expectModel: false,
    expectModelFlag: false,
    expectDelay: false,
    expectMaxCost: false,
    expectMaxRuntime: false,
    expectMaxFailures: false,
    expectMaxIterations: false,
    expectProjectRoot: false,
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
  if (state.expectModel) {
    if (VALID_MODELS.has(arg)) {
      args.model = arg;
      state.expectModel = false;
      return true;
    }
    state.expectModel = false;
    // fall through: token wasn't a model, let caller try it
  }
  if (state.expectModelFlag) {
    if (!VALID_MODELS.has(arg)) {
      throw new Error("Invalid model");
    }
    args.model = arg;
    state.expectModelFlag = false;
    return true;
  }
  if (state.expectDelay) {
    args.delay = parseInt(arg, 10);
    state.expectDelay = false;
    return true;
  }
  if (state.expectMaxCost) {
    args.maxCostUsd = parseFloat(arg);
    state.expectMaxCost = false;
    return true;
  }
  if (state.expectMaxRuntime) {
    args.maxRuntimeMinutes = parseFloat(arg);
    state.expectMaxRuntime = false;
    return true;
  }
  if (state.expectMaxFailures) {
    args.maxConsecutiveFailures = parseInt(arg, 10);
    state.expectMaxFailures = false;
    return true;
  }
  if (state.expectMaxIterations) {
    args.maxIterations = parseInt(arg, 10);
    state.expectMaxIterations = false;
    return true;
  }
  if (state.expectProjectRoot) {
    args.projectRoot = arg;
    state.expectProjectRoot = false;
    return true;
  }

  switch (arg) {
    case "--claude":
      if (args.engineSet && args.engine !== "claude") {
        throw new Error("Choose only one engine flag: --claude or --codex");
      }
      args.engine = "claude";
      args.engineSet = true;
      state.expectModel = true;
      return true;
    case "--codex":
      if (args.engineSet && args.engine !== "codex") {
        throw new Error("Choose only one engine flag: --claude or --codex");
      }
      args.engine = "codex";
      args.engineSet = true;
      return true;
    case "--model":
      state.expectModelFlag = true;
      return true;
    case "--delay":
      state.expectDelay = true;
      return true;
    case "--max-cost":
      state.expectMaxCost = true;
      return true;
    case "--max-runtime":
      state.expectMaxRuntime = true;
      return true;
    case "--max-failures":
      state.expectMaxFailures = true;
      return true;
    case "--max-iterations":
      state.expectMaxIterations = true;
      return true;
    case "--unlimited":
      args.maxIterations = 0;
      return true;
    case "--log":
      args.log = true;
      return true;
    case "--verbose":
      args.verbose = true;
      return true;
    case "--project-root":
      state.expectProjectRoot = true;
      return true;
    default:
      return false;
  }
}
