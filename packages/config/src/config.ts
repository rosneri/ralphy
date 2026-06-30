/**
 * One config pipeline (issue #404): argv ⊕ WORKFLOW.md ⊕ schema defaults,
 * merged in exactly one place with explicit `cli > workflow > default`
 * precedence and a provenance witness.
 *
 * Presence is the only signal of user intent — `CliOverrides` carries exactly
 * the keys argv set (no baked defaults, no sentinels), and the WORKFLOW.md
 * side distinguishes "the author wrote this key" from "Zod filled the
 * default" via `explicitWorkflowKeys`. App code never writes
 * `args.x || cfg.y` again: it calls `resolveConfig` at boot and reads
 * `effective`; child workers receive `serializeOverrides(overrides)` and
 * re-resolve against the same WORKFLOW.md, so parent and child apply
 * precedence through one code path.
 */
import {
  AGENT_OVERRIDE_KEYS,
  AGENT_OVERRIDE_TO_WORKFLOW_KEY,
  type AgentOverrides,
  type CliOverrides,
  type CliPassthrough,
  type CommonArgs,
} from "@ralphy/cli-args";
import { parseCommonArgv } from "@ralphy/cli-args/parse-common-args";
import {
  DEFAULT_WORKFLOW_MD,
  explicitWorkflowKeys,
  migrateWorkflowMarkdown,
  normalizeWorkflowMarkdown,
  parseWorkflow,
  workflowPath,
  type WorkflowConfig,
} from "@ralphy/workflow";
import type { LoopOptions } from "@ralphy/core/loop";
import {
  OVERRIDE_KEYS,
  OVERRIDE_TO_WORKFLOW_KEY,
  type ConfigOrigin,
  type OriginKey,
} from "./override-keys";
import { loopOptionsFromConfig, type LoopRuntime } from "./loop-options";

export type { AgentOverrides, CliOverrides, CliPassthrough, CommonArgs } from "@ralphy/cli-args";
export type { WorkflowConfig } from "@ralphy/workflow";

/**
 * Narrow a CLI model string (already validated by the parser against the
 * schema enum) back to the workflow's model type. Falls back to the workflow
 * value for anything unexpected so a hand-constructed override can never
 * poison the effective config.
 */
function asWorkflowModel(
  value: string | undefined,
  fallback: WorkflowConfig["model"],
): WorkflowConfig["model"] {
  if (value === "fable" || value === "opus" || value === "sonnet" || value === "haiku") {
    return value;
  }
  return fallback;
}

/** Same narrowing for `--effort` (see `asWorkflowModel`). */
function asWorkflowEffort(
  value: string | undefined,
  fallback: WorkflowConfig["effort"],
): WorkflowConfig["effort"] {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  ) {
    return value;
  }
  return fallback;
}

/**
 * Pure merge core — `cli > workflow > default` for every override key, plus
 * the per-key provenance map. `explicitKeys` is the set of top-level
 * WORKFLOW.md keys the author actually wrote (see `explicitWorkflowKeys`);
 * without it every non-CLI value reports `"default"`.
 */
export function mergeConfig(
  workflow: WorkflowConfig,
  overrides: CliOverrides,
  explicitKeys: ReadonlySet<string> = new Set(),
  agentOverrides: AgentOverrides = {},
): { effective: WorkflowConfig; origin: Map<OriginKey, ConfigOrigin> } {
  // `effort` is optional with no default — under exactOptionalPropertyTypes it
  // is spread in conditionally rather than assigned a possible undefined.
  const effort = asWorkflowEffort(overrides.effort, workflow.effort);
  const effective: WorkflowConfig = {
    ...workflow,
    engine: overrides.engine ?? workflow.engine,
    model: asWorkflowModel(overrides.model, workflow.model),
    ...(effort !== undefined ? { effort } : {}),
    maxIterationsPerTask: overrides.maxIterations ?? workflow.maxIterationsPerTask,
    maxCostUsdPerTask: overrides.maxCostUsd ?? workflow.maxCostUsdPerTask,
    maxRuntimeMinutesPerTask: overrides.maxRuntimeMinutes ?? workflow.maxRuntimeMinutesPerTask,
    maxConsecutiveFailuresPerTask:
      overrides.maxConsecutiveFailures ?? workflow.maxConsecutiveFailuresPerTask,
    iterationDelaySeconds: overrides.delay ?? workflow.iterationDelaySeconds,
    logRawStream: overrides.log ?? workflow.logRawStream,
    taskVerbose: overrides.verbose ?? workflow.taskVerbose,
    enableManualTest: overrides.manualTest ?? workflow.enableManualTest,
    // Agent-only overrides, applied through the same `cli > workflow > default`
    // core. `linearTeam` / `codeReview` target nested `linear.*` fields, so the
    // `linear` container is rebuilt once with both (E2) rather than clobbered.
    concurrency: agentOverrides.concurrency ?? workflow.concurrency,
    pollIntervalSeconds: agentOverrides.pollInterval ?? workflow.pollIntervalSeconds,
    useWorktree: agentOverrides.worktree ?? workflow.useWorktree,
    createPrOnSuccess: agentOverrides.createPr ?? workflow.createPrOnSuccess,
    stackPrsOnDependencies: agentOverrides.stackPrs ?? workflow.stackPrsOnDependencies,
    linear: {
      ...workflow.linear,
      team: agentOverrides.linearTeam ?? workflow.linear.team,
      codeReviewTrigger: agentOverrides.codeReview ?? workflow.linear.codeReviewTrigger,
    },
  };
  const origin = new Map<OriginKey, ConfigOrigin>();
  for (const key of OVERRIDE_KEYS) {
    if (overrides[key] !== undefined) origin.set(key, "cli");
    else if (explicitKeys.has(OVERRIDE_TO_WORKFLOW_KEY[key])) origin.set(key, "workflow");
    else origin.set(key, "default");
  }
  for (const key of AGENT_OVERRIDE_KEYS) {
    if (agentOverrides[key] !== undefined) origin.set(key, "cli");
    else if (explicitKeys.has(AGENT_OVERRIDE_TO_WORKFLOW_KEY[key])) origin.set(key, "workflow");
    else origin.set(key, "default");
  }
  return { effective, origin };
}

/** The only effect in this package: reading WORKFLOW.md (and `--prompt-file`). */
export interface ConfigFileSystem {
  /** Returns null when the file does not exist. */
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
}

const bunFileSystem: ConfigFileSystem = {
  async readText(path) {
    const file = Bun.file(path);
    return (await file.exists()) ? await file.text() : null;
  },
  async writeText(path, text) {
    await Bun.write(path, text);
  },
};

/** Resolved values at boot — defaults ⊕ WORKFLOW.md ⊕ CLI, plus provenance. */
export interface ResolvedConfig {
  readonly effective: WorkflowConfig;
  readonly cli: CliPassthrough;
  /** Exactly what argv set — re-serializable for child workers. */
  readonly overrides: Readonly<CliOverrides>;
  /** Sparse agent-only overrides — `{}` for non-agent callers (e.g. the loop). */
  readonly agentOverrides: Readonly<AgentOverrides>;
  readonly workflowPath: string;
  /** Testable precedence witness — accepts both common and agent override keys. */
  origin(key: OriginKey): ConfigOrigin;
  /** Config-derived fields + caller-injected runtime. */
  loopOptions(runtime: LoopRuntime): LoopOptions;
}

export interface ResolveConfigInput {
  argv: string[];
  /** Fallback project root when `--project-root` is not on argv. Explicit —
   *  this package never reads `process.cwd()`. */
  projectRoot?: string;
  fileSystem?: ConfigFileSystem;
}

/**
 * The only entry apps call at boot: parses argv (skipping app-bespoke
 * tokens), loads + migrates WORKFLOW.md, merges. Apps that already ran a
 * bespoke parser can hand their parsed `CommonArgs` to `resolveParsedConfig`
 * instead and skip the re-parse.
 */
export async function resolveConfig(input: ResolveConfigInput): Promise<ResolvedConfig> {
  const fileSystem = input.fileSystem ?? bunFileSystem;
  const { args } = await parseCommonArgv(input.argv, async (path) => {
    const text = await fileSystem.readText(path);
    if (text === null) {
      const err = new Error("--prompt-file not found") as Error & { path?: string };
      err.path = path;
      throw err;
    }
    return text;
  });
  return resolveParsedConfig({
    args,
    ...(input.projectRoot !== undefined ? { projectRoot: input.projectRoot } : {}),
    fileSystem,
  });
}

export interface ResolveParsedConfigInput {
  /** The common slice of an app's parsed argv (sparse overrides + passthrough). */
  args: CommonArgs;
  /** Sparse agent-only overrides — omit (defaults to `{}`) for non-agent apps. */
  agentOverrides?: AgentOverrides;
  projectRoot?: string;
  fileSystem?: ConfigFileSystem;
}

/** `resolveConfig` for apps that already parsed argv with `@ralphy/cli-args`. */
export async function resolveParsedConfig(
  input: ResolveParsedConfigInput,
): Promise<ResolvedConfig> {
  const fileSystem = input.fileSystem ?? bunFileSystem;
  const { args } = input;
  const projectRoot = args.projectRoot ?? input.projectRoot;
  if (projectRoot === undefined) {
    throw new Error("resolveConfig needs a projectRoot (pass one, or use --project-root)");
  }
  const path = workflowPath(projectRoot, args.workflowFile);
  const text = await fileSystem.readText(path);

  let workflow: WorkflowConfig;
  let explicitKeys: ReadonlySet<string>;
  if (text === null) {
    // Missing file: pure schema defaults. The default template is parsed (not
    // hand-built) so this stays identical to `loadWorkflow`'s fallback.
    workflow = parseWorkflow(DEFAULT_WORKFLOW_MD).config;
    explicitKeys = new Set<string>();
  } else {
    // Versioned migration first, then in-memory self-heal — the same pipeline
    // as `loadWorkflow` (no persistence from here; that stays an init-only,
    // deliberate action). The explicit-keys witness is captured from the
    // MIGRATED text, before normalize materializes every default-bearing key.
    const migrated = migrateWorkflowMarkdown(text);
    const normalized = normalizeWorkflowMarkdown(migrated.markdown);
    workflow = parseWorkflow(normalized.markdown, path).config;
    explicitKeys = explicitWorkflowKeys(migrated.markdown);
  }

  const agentOverridesInput = input.agentOverrides ?? {};
  const { effective, origin } = mergeConfig(
    workflow,
    args.overrides,
    explicitKeys,
    agentOverridesInput,
  );
  const overrides: Readonly<CliOverrides> = { ...args.overrides };
  const agentOverrides: Readonly<AgentOverrides> = { ...agentOverridesInput };
  const cli: CliPassthrough = {
    projectRoot: args.projectRoot,
    workflowFile: args.workflowFile,
    name: args.name,
    prompt: args.prompt,
    fromAgent: args.fromAgent,
  };
  return {
    effective,
    cli,
    overrides,
    agentOverrides,
    workflowPath: path,
    origin: (key) => origin.get(key) ?? "default",
    loopOptions: (runtime) => loopOptionsFromConfig(effective, runtime),
  };
}
