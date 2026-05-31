/**
 * Pure builders for the first-run setup wizard (`ralphy init`).
 *
 * The wizard collects answers via an Ink UI in the `@ralphy/init` app; this
 * module turns those answers into a WORKFLOW.md string. It edits the canonical
 * `DEFAULT_WORKFLOW_MD` frontmatter with anchored line replacements rather than
 * re-emitting parsed YAML, so the template's section dividers, comments, and
 * blank-line grouping stay byte-identical except for the lines the wizard
 * actually changes. The output always round-trips through `parseWorkflow`.
 */

import YAML from "yaml";
import { DEFAULT_WORKFLOW_MD } from "./default";

export type SetupMode = "quick" | "permissive" | "customized";

/** Curated Linear indicator templates offered by the wizard. */
export type IndicatorPreset = "none" | "status-standard" | "label-standard";

export interface WizardAnswers {
  mode: SetupMode;
  project?: { name?: string; language?: string; framework?: string };
  commands?: { test?: string; lint?: string; build?: string; typecheck?: string };
  engine?: "claude" | "codex";
  model?: "haiku" | "sonnet" | "opus";
  concurrency?: number;
  createPrOnSuccess?: boolean;
  fixCiOnFailure?: boolean;
  useWorktree?: boolean;
  prBaseBranch?: string;
  linear?: { team?: string; assignee?: string; indicatorsPreset?: IndicatorPreset };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Render a value as a YAML-safe scalar (quoting only when required). */
function yamlScalar(value: string | number | boolean): string {
  return YAML.stringify(value).trimEnd();
}

/**
 * Replace the value of an existing top-level/leaf key, preserving indentation.
 * `key` is always a static YAML identifier from the template, so it is safe to
 * interpolate into the regex directly.
 */
function setScalar(frontmatter: string, key: string, value: string | number | boolean): string {
  const re = new RegExp(`^(\\s*)${key}:.*$`, "m");
  if (!re.test(frontmatter)) {
    throw new Error(`setup wizard: expected key "${key}" in the default WORKFLOW.md template`);
  }
  return frontmatter.replace(
    re,
    (_match, indent: string) => `${indent}${key}: ${yamlScalar(value)}`,
  );
}

/** Insert a line immediately after the line that defines `afterKey`. */
function insertAfter(frontmatter: string, afterKey: string, line: string): string {
  const re = new RegExp(`^(\\s*)${afterKey}:.*$`, "m");
  if (!re.test(frontmatter)) {
    throw new Error(`setup wizard: expected key "${afterKey}" in the default WORKFLOW.md template`);
  }
  return frontmatter.replace(re, (match) => `${match}\n${line}`);
}

/**
 * Fill in `linear.team` / `linear.assignee` by replacing the commented
 * `# team: ENG` example, so the keys land at the natural top of the linear
 * block. When neither is given the example comment is left untouched.
 */
function setLinearIdentity(
  frontmatter: string,
  team: string | undefined,
  assignee: string | undefined,
): string {
  if (!team && !assignee) return frontmatter;
  const lines: string[] = [];
  if (team) lines.push(`  team: ${yamlScalar(team)}`);
  if (assignee) lines.push(`  assignee: ${yamlScalar(assignee)}`);
  return frontmatter.replace(/^[ \t]*#\s*team:.*$/m, lines.join("\n"));
}

interface IndicatorMarker {
  type: "status" | "label" | "attachment" | "project" | "comment";
  value: string;
}
type IndicatorMap = Record<string, { filter: IndicatorMarker[] } | IndicatorMarker>;

function buildIndicators(preset: Exclude<IndicatorPreset, "none">): IndicatorMap {
  if (preset === "status-standard") {
    return {
      getTodo: { filter: [{ type: "status", value: "Todo" }] },
      getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "In Review" },
      setError: { type: "label", value: "ralph:error" },
    };
  }
  // label-standard
  return {
    getTodo: { filter: [{ type: "label", value: "ralph:todo" }] },
    setInProgress: { type: "label", value: "ralph:in-progress" },
    setDone: { type: "label", value: "ralph:done" },
    setError: { type: "label", value: "ralph:error" },
  };
}

/**
 * Replace the commented `indicators:` example block (which runs to the end of
 * the frontmatter) with a concrete generated block. The explanatory comment
 * that precedes the `indicators:` key is left in place.
 */
function setIndicators(frontmatter: string, indicators: IndicatorMap): string {
  const match = /^[ \t]*indicators:/m.exec(frontmatter);
  if (!match) {
    throw new Error(`setup wizard: expected "indicators:" in the default WORKFLOW.md template`);
  }
  const before = frontmatter.slice(0, match.index);
  const yaml = YAML.stringify({ indicators }, { schema: "core" }).trimEnd();
  // Nest the generated block one level under `linear:` (two-space indent).
  const indented = yaml
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
  return `${before}${indented}`;
}

interface ResolvedOverrides {
  scalars: Map<string, string | number | boolean>;
  inserts: { afterKey: string; line: string }[];
  linearTeam: string | undefined;
  linearAssignee: string | undefined;
  indicatorsPreset: IndicatorPreset;
}

function resolveOverrides(answers: WizardAnswers): ResolvedOverrides {
  const scalars = new Map<string, string | number | boolean>();
  const inserts: { afterKey: string; line: string }[] = [];

  // Project name is offered in every mode.
  if (answers.project?.name) scalars.set("name", answers.project.name);

  if (answers.mode === "permissive") {
    scalars.set("createPrOnSuccess", true);
    scalars.set("fixCiOnFailure", true);
    inserts.push({
      afterKey: "autoMergeStrategy",
      line: "manualMergeWhenAutoMergeDisabled: false",
    });
  }

  if (answers.mode === "customized") {
    if (answers.project?.language) scalars.set("language", answers.project.language);
    if (answers.project?.framework) scalars.set("framework", answers.project.framework);
    if (answers.commands?.test) scalars.set("test", answers.commands.test);
    if (answers.commands?.lint) scalars.set("lint", answers.commands.lint);
    if (answers.commands?.build) scalars.set("build", answers.commands.build);
    if (answers.commands?.typecheck) scalars.set("typecheck", answers.commands.typecheck);
    if (answers.engine) scalars.set("engine", answers.engine);
    if (answers.model) scalars.set("model", answers.model);
    if (answers.concurrency !== undefined) scalars.set("concurrency", answers.concurrency);
    if (answers.prBaseBranch) scalars.set("prBaseBranch", answers.prBaseBranch);
    if (answers.createPrOnSuccess !== undefined) {
      scalars.set("createPrOnSuccess", answers.createPrOnSuccess);
    }
    if (answers.fixCiOnFailure !== undefined) scalars.set("fixCiOnFailure", answers.fixCiOnFailure);
    if (answers.useWorktree !== undefined) scalars.set("useWorktree", answers.useWorktree);
  }

  return {
    scalars,
    inserts,
    linearTeam: answers.linear?.team,
    linearAssignee: answers.linear?.assignee,
    indicatorsPreset:
      answers.mode === "customized" ? (answers.linear?.indicatorsPreset ?? "none") : "none",
  };
}

/**
 * Build a WORKFLOW.md string from wizard answers. Starts from the canonical
 * default template and applies only the values the wizard collected, so the
 * result keeps all the default's explanatory comments and formatting.
 */
export function buildWorkflowMarkdown(answers: WizardAnswers): string {
  const m = FRONTMATTER_RE.exec(DEFAULT_WORKFLOW_MD);
  if (!m) throw new Error("setup wizard: default WORKFLOW.md template is malformed");
  let frontmatter = m[1] ?? "";
  const body = m[2] ?? "";

  const overrides = resolveOverrides(answers);

  for (const [key, value] of overrides.scalars) {
    frontmatter = setScalar(frontmatter, key, value);
  }
  for (const insert of overrides.inserts) {
    frontmatter = insertAfter(frontmatter, insert.afterKey, insert.line);
  }
  frontmatter = setLinearIdentity(frontmatter, overrides.linearTeam, overrides.linearAssignee);
  if (overrides.indicatorsPreset !== "none") {
    frontmatter = setIndicators(frontmatter, buildIndicators(overrides.indicatorsPreset));
  }

  return `---\n${frontmatter}\n---\n${body}`;
}

/**
 * Apply wizard answers onto an EXISTING WORKFLOW.md, preserving everything the
 * wizard does not touch (custom rules, existing indicators, comments, body).
 * Used when editing a file that already exists. Only keys present in `answers`
 * are written; the indicator block is rewritten only when a preset is chosen.
 */
export function applyAnswersToWorkflow(existing: string, answers: WizardAnswers): string {
  const m = FRONTMATTER_RE.exec(existing);
  if (!m) {
    throw new Error("setup wizard: WORKFLOW.md is missing its YAML frontmatter block");
  }
  const body = m[2] ?? "";
  const doc = YAML.parseDocument(m[1] ?? "");

  const set = (path: string[], value: string | number | boolean): void => doc.setIn(path, value);

  if (answers.project?.name) set(["project", "name"], answers.project.name);
  if (answers.project?.language) set(["project", "language"], answers.project.language);
  if (answers.project?.framework) set(["project", "framework"], answers.project.framework);
  if (answers.commands?.test) set(["commands", "test"], answers.commands.test);
  if (answers.commands?.lint) set(["commands", "lint"], answers.commands.lint);
  if (answers.commands?.build) set(["commands", "build"], answers.commands.build);
  if (answers.commands?.typecheck) set(["commands", "typecheck"], answers.commands.typecheck);
  if (answers.engine) set(["engine"], answers.engine);
  if (answers.model) set(["model"], answers.model);
  if (answers.concurrency !== undefined) set(["concurrency"], answers.concurrency);
  if (answers.prBaseBranch) set(["prBaseBranch"], answers.prBaseBranch);
  if (answers.createPrOnSuccess !== undefined)
    set(["createPrOnSuccess"], answers.createPrOnSuccess);
  if (answers.fixCiOnFailure !== undefined) set(["fixCiOnFailure"], answers.fixCiOnFailure);
  if (answers.useWorktree !== undefined) set(["useWorktree"], answers.useWorktree);
  if (answers.linear?.team) set(["linear", "team"], answers.linear.team);
  if (answers.linear?.assignee) set(["linear", "assignee"], answers.linear.assignee);
  const preset = answers.linear?.indicatorsPreset;
  if (preset && preset !== "none") {
    doc.setIn(["linear", "indicators"], buildIndicators(preset));
  }

  return `---\n${doc.toString().replace(/\n+$/, "")}\n---\n${body}`;
}
