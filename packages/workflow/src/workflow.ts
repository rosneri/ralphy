import { join } from "node:path";
import YAML from "yaml";
import { WorkflowConfigSchema, type WorkflowConfig } from "./schema";
import { DEFAULT_WORKFLOW_MD, FRONTMATTER_RE } from "./default";
import { renderTemplate } from "./template";
import { buildWorkflowMarkdown } from "./wizard";
import { normalizeWorkflowMarkdown } from "./migrate/normalize";

export type { WorkflowConfig } from "./schema";
export { WorkflowConfigSchema, CURRENT_WORKFLOW_VERSION } from "./schema";
export { renderTemplate } from "./template";
export { DEFAULT_WORKFLOW_MD, FRONTMATTER_RE } from "./default";
export {
  computeConfirmationFlags,
  describeApprovalMarker,
  matchesIndicator,
  type ConfirmationTicketView,
} from "./confirmation";
export { resolveLinearFilter, applyAssigneeOverride } from "./linear-filter";
export type { LinearFilter, LinearFilterMarker, ResolvedLinearFilter } from "@ralphy/types";
export {
  normalizeWorkflowMarkdown,
  DEFAULT_APPROVAL_INDICATORS,
  type NormalizeResult,
} from "./migrate/normalize";

export interface ParsedWorkflow {
  config: WorkflowConfig;
  body: string;
  /** Path the workflow was read from. Empty when parsed from a literal string. */
  path: string;
}

export function parseWorkflow(text: string, path = ""): ParsedWorkflow {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) {
    throw new Error(
      `WORKFLOW.md is missing the YAML frontmatter block (expected leading "---" / trailing "---").` +
        (path ? `\n  File: ${path}` : ""),
    );
  }
  const yamlText = m[1] ?? "";
  const body = m[2] ?? "";

  let raw: unknown;
  try {
    raw = YAML.parse(yamlText, { schema: "core" });
  } catch (err) {
    throw new Error(
      `WORKFLOW.md frontmatter is not valid YAML.\n` +
        (path ? `  File: ${path}\n` : "") +
        `  ${(err as Error).message}`,
    );
  }
  if (raw == null) raw = {};

  rejectInlineFilterArrays(raw, path);

  const parsed = WorkflowConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `WORKFLOW.md has invalid settings:\n${issues}\n\nRun \`ralph init\` to see the default WORKFLOW.md.`,
    );
  }

  applyAliases(parsed.data);
  return { config: parsed.data, body, path };
}

/**
 * Reject inline flow-style filter arrays (`filter: [{type: status, ...}]`) inside
 * `linear.indicators.*`. Block-style lists are required so the file stays
 * grep-friendly and consistent across editors.
 */
function rejectInlineFilterArrays(raw: unknown, path: string): void {
  if (!raw || typeof raw !== "object") return;
  const root = raw as Record<string, unknown>;
  const linear = root["linear"];
  if (!linear || typeof linear !== "object") return;
  const indicators = (linear as Record<string, unknown>)["indicators"];
  if (!indicators || typeof indicators !== "object") return;
  for (const [k, v] of Object.entries(indicators)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    if (!Object.prototype.hasOwnProperty.call(v, "filter")) continue;
    const filter = (v as Record<string, unknown>)["filter"];
    if (filter !== undefined && !Array.isArray(filter)) {
      throw new Error(
        `WORKFLOW.md: linear.indicators.${k}.filter must be a YAML block-style list.\n` +
          (path ? `  File: ${path}\n` : "") +
          `  Inline JSON-array form is not accepted — use a "- " list.`,
      );
    }
  }
}

/**
 * Bridge the new-shape blocks (`agent.engine`, `github.base_branch`, `ci.*`,
 * `worktree.*`) onto the flat fields the rest of the codebase already reads.
 * Top-level keys win when both are present so legacy configs keep working.
 */
function applyAliases(cfg: WorkflowConfig): void {
  if (cfg.github) {
    if (cfg.github.base_branch !== undefined && cfg.prBaseBranch === "main") {
      cfg.prBaseBranch = cfg.github.base_branch;
    }
    if (cfg.github.auto_merge_strategy !== undefined && cfg.autoMergeStrategy === "squash") {
      cfg.autoMergeStrategy = cfg.github.auto_merge_strategy;
    }
  }
  if (cfg.agent) {
    if (cfg.agent.engine !== undefined) cfg.engine = cfg.agent.engine;
    if (cfg.agent.model !== undefined) cfg.model = cfg.agent.model;
    if (cfg.agent.concurrency !== undefined && cfg.concurrency === 1) {
      cfg.concurrency = cfg.agent.concurrency;
    }
    if (cfg.agent.max_iterations_per_task !== undefined && cfg.maxIterationsPerTask === 0) {
      cfg.maxIterationsPerTask = cfg.agent.max_iterations_per_task;
    }
    if (
      cfg.agent.max_consecutive_failures !== undefined &&
      cfg.maxConsecutiveFailuresPerTask === 5
    ) {
      cfg.maxConsecutiveFailuresPerTask = cfg.agent.max_consecutive_failures;
    }
  }
  if (cfg.worktree) {
    if (cfg.worktree.enabled !== undefined) cfg.useWorktree = cfg.worktree.enabled;
    if (cfg.worktree.cleanup_on_success !== undefined) {
      cfg.cleanupWorktreeOnSuccess = cfg.worktree.cleanup_on_success;
    }
    if (cfg.worktree.setup_script !== undefined && cfg.setupScript === undefined) {
      cfg.setupScript = cfg.worktree.setup_script;
    }
  }
  if (cfg.ci) {
    if (cfg.ci.fix_on_failure !== undefined) cfg.fixCiOnFailure = cfg.ci.fix_on_failure;
    if (cfg.ci.max_attempts !== undefined) cfg.maxCiFixAttempts = cfg.ci.max_attempts;
    if (cfg.ci.poll_interval_seconds !== undefined) {
      cfg.ciPollIntervalSeconds = cfg.ci.poll_interval_seconds;
    }
  }
}

export const WORKFLOW_FILE = "WORKFLOW.md";

/**
 * Resolve the workflow file location. When `workflowFile` is given it wins
 * (callers are expected to pass an already-absolute path); otherwise the
 * canonical `<projectRoot>/WORKFLOW.md` is used.
 */
export function workflowPath(projectRoot: string, workflowFile?: string): string {
  return workflowFile ?? join(projectRoot, WORKFLOW_FILE);
}

export interface LoadWorkflowOptions {
  /**
   * When true, a self-heal that changed the file is written back to disk.
   * Defaults to false: every load still normalizes in-memory (so the runtime
   * always sees backfilled defaults and the confirmation-gate invariant), but
   * the file is only rewritten from deliberate, single-working-copy entrypoints
   * (`ralphy init`) — never from the agent/worktree hot path, where a stray
   * WORKFLOW.md diff could leak into a task branch.
   */
  persist?: boolean;
}

export async function loadWorkflow(
  projectRoot: string,
  workflowFile?: string,
  options: LoadWorkflowOptions = {},
): Promise<ParsedWorkflow> {
  const path = workflowPath(projectRoot, workflowFile);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    const { config } = parseWorkflow(DEFAULT_WORKFLOW_MD);
    return { config, body: extractDefaultBody(), path };
  }
  const text = await file.text();
  // Self-heal in-memory: backfill missing default-bearing keys and enforce the
  // confirmation-gate invariant. Persist only when the caller opts in.
  const normalized = normalizeWorkflowMarkdown(text);
  if (normalized.changed && options.persist) await Bun.write(path, normalized.markdown);
  return parseWorkflow(normalized.markdown, path);
}

export async function ensureWorkflow(projectRoot: string, workflowFile?: string): Promise<string> {
  const path = workflowPath(projectRoot, workflowFile);
  const file = Bun.file(path);
  if (await file.exists()) return path;
  // Write the stamped build so the file carries each setting's description.
  await Bun.write(path, buildWorkflowMarkdown({ mode: "quick", values: {} }));
  return path;
}

function extractDefaultBody(): string {
  const m = FRONTMATTER_RE.exec(DEFAULT_WORKFLOW_MD);
  return m ? (m[2] ?? "") : "";
}

/**
 * Render the workflow body against a context. Convenience wrapper used by
 * the agent prompt builder to produce the per-iteration prompt addendum.
 */
/**
 * Resolve the effective list of "baseline" commands to run for the
 * pre-existing-error gate. Returns the user-configured `commands` list when
 * non-empty; otherwise falls back to `commands.lint` and `commands.test`
 * (in that order, skipping any that aren't configured).
 */
export function resolveBaselineCommands(config: WorkflowConfig): string[] {
  const configured = config.preExistingErrorCheck?.commands ?? [];
  if (configured.length > 0) return [...configured];
  const fallback: string[] = [];
  if (config.commands.lint) fallback.push(config.commands.lint);
  if (config.commands.test) fallback.push(config.commands.test);
  return fallback;
}

export function renderWorkflowPrompt(
  workflow: ParsedWorkflow,
  ctx: Record<string, unknown>,
): string {
  const fullCtx = {
    project: workflow.config.project,
    commands: workflow.config.commands,
    rules: workflow.config.rules,
    boundaries: workflow.config.boundaries,
    ...ctx,
  };
  return renderTemplate(workflow.body, fullCtx);
}
