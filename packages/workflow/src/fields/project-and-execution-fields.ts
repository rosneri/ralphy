import type { Field } from "../fields";
import { no, selectFromSchema } from "./field-spec-builders";
import { trackerIsGithub } from "./field-conditions";

/**
 * Customized-walkthrough fields covering project metadata, the command set, the
 * engine/model, the issue tracker, scheduling, and per-task limits. `PROJECT_NAME`
 * (shared with the quick mode) is prepended by `customized-fields.ts`.
 */
export const PROJECT_AND_EXECUTION_FIELDS: Field[] = [
  // ── Project ──
  {
    id: "project.language",
    label: "Language",
    description:
      "Primary programming language (e.g. TypeScript). Added to the agent's prompt as context.",
    spec: { kind: "text", placeholder: "TypeScript" },
  },
  {
    id: "project.framework",
    label: "Framework",
    description:
      "Primary framework or toolchain (e.g. Bun + Nx). Added to the agent's prompt as context.",
    spec: { kind: "text", placeholder: "Bun + Nx" },
  },

  // ── Commands ──
  {
    id: "commands.test",
    label: "Test command",
    description:
      "Shell command Ralphy runs to check the agent's work each iteration; its exit code decides pass or fail.",
    spec: { kind: "text", placeholder: "bun test" },
  },
  {
    id: "commands.lint",
    label: "Lint command",
    description: "Shell command Ralphy runs to lint the code before a task is allowed to finish.",
    spec: { kind: "text", placeholder: "bun run lint" },
  },
  {
    id: "commands.build",
    label: "Build command",
    description: "Shell command Ralphy runs to confirm the project still compiles / builds.",
    spec: { kind: "text", placeholder: "bun run build" },
  },
  {
    id: "commands.typecheck",
    label: "Typecheck command",
    description: "Shell command Ralphy runs to confirm the project's types still pass.",
    spec: { kind: "text", placeholder: "bun run typecheck" },
  },
  {
    id: "commands.structure",
    label: "Structure command",
    description:
      "Shell command Ralphy runs each iteration to enforce the project's structural guardrails (file size, layering, no-reexport, etc.). Defaults to `bun run check:structure`; set it empty to opt out.",
    spec: { kind: "text", placeholder: "bun run check:structure" },
  },

  // ── Engine ──
  {
    id: "engine",
    label: "Engine",
    description:
      "Which AI coding tool runs the loop: 'claude' (Claude Code) or 'codex' (OpenAI Codex).",
    spec: selectFromSchema("engine"),
  },
  {
    id: "model",
    label: "Model tier",
    description:
      "Model tier the engine uses. 'opus' is the most capable, 'haiku' the cheapest and fastest; higher tiers cost more per token.",
    spec: selectFromSchema("model"),
  },
  {
    id: "logRawStream",
    label: "Log the raw engine stream to stdout?",
    description:
      "Print the engine's raw event stream to the terminal. Very verbose — mainly for debugging.",
    spec: no(),
  },
  {
    id: "taskVerbose",
    label: "Show detailed task output?",
    description:
      "Show detailed per-task output (passes --verbose to the task sub-process) for extra diagnostics.",
    spec: no(),
  },

  // ── Tracker ──
  {
    id: "tracker.kind",
    label: "Issue tracker",
    description:
      "Which issue tracker drives the loop: 'linear' (the default) or 'github' (GitHub Issues, via the gh CLI).",
    spec: selectFromSchema("tracker.kind", { linear: "Linear", github: "GitHub" }),
  },
  {
    id: "github.issues.repo",
    label: "GitHub repository (owner/name)",
    hint: "blank = detected from origin",
    description:
      "The owner/name of the GitHub repo whose issues drive the loop. Leave blank to use the repo detected from the git 'origin' remote.",
    emptyLabel: "detected from origin",
    spec: { kind: "text", placeholder: "owner/name" },
    when: trackerIsGithub,
  },
  {
    id: "github.issues.label",
    label: "Todo label",
    hint: "blank = any open issue",
    description:
      "Only pick up GitHub issues carrying this label. Leave blank to consider every open issue.",
    emptyLabel: "any open issue",
    spec: { kind: "text", placeholder: "ralph:todo" },
    when: trackerIsGithub,
  },
  {
    id: "github.issues.assignee",
    label: "Assignee filter",
    hint: "blank = any assignee; @me = you",
    description:
      "Only pick up GitHub issues assigned to this login. Use '@me' for yourself; leave blank to ignore the assignee.",
    emptyLabel: "any assignee",
    spec: { kind: "text", placeholder: "@me" },
    when: trackerIsGithub,
  },
  {
    id: "github.issues.statusLabels.inProgress",
    label: "In-progress label",
    description:
      "GitHub label applied to an issue while Ralphy is actively working on it (and removed from the todo label).",
    spec: { kind: "text", placeholder: "ralph:in-progress" },
    when: trackerIsGithub,
  },
  {
    id: "github.issues.statusLabels.done",
    label: "Done label",
    description:
      "GitHub label applied to an issue when its work completes; the issue is also closed.",
    spec: { kind: "text", placeholder: "ralph:done" },
    when: trackerIsGithub,
  },
  {
    id: "github.issues.statusLabels.error",
    label: "Error label",
    description:
      "GitHub label applied to an issue when Ralphy quarantines it after repeated failures.",
    spec: { kind: "text", placeholder: "ralph:error" },
    when: trackerIsGithub,
  },

  // ── Scheduling ──
  {
    id: "concurrency",
    label: "Concurrency (parallel tasks)",
    description:
      "How many tasks Ralphy works on at once. Higher finishes faster but uses more API quota simultaneously.",
    spec: { kind: "number", placeholder: "1" },
  },
  {
    id: "pollIntervalSeconds",
    label: "Poll interval (seconds)",
    description:
      "In agent mode, how often (in seconds) Ralphy checks Linear for new issues to pick up.",
    spec: { kind: "number", placeholder: "60" },
  },
  {
    id: "iterationDelaySeconds",
    label: "Delay between iterations (seconds)",
    description:
      "Seconds to pause between loop iterations — a throttle to slow spend. 0 means no pause.",
    spec: { kind: "number", placeholder: "0" },
  },

  // ── Per-task limits (0 = unlimited) ──
  {
    id: "maxIterationsPerTask",
    label: "Max iterations per task (0 = unlimited)",
    description:
      "Stop a task after this many loop iterations. 0 means no limit (run until done or another limit hits).",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxCostUsdPerTask",
    label: "Max cost USD per task (0 = unlimited)",
    description:
      "Stop a task once its API spend passes this many US dollars. 0 means no cost limit.",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxRuntimeMinutesPerTask",
    label: "Max runtime minutes per task (0 = unlimited)",
    description: "Stop a task after this many minutes of wall-clock time. 0 means no time limit.",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxConsecutiveFailuresPerTask",
    label: "Max consecutive identical failures",
    description:
      "Give up on a task after this many identical failures in a row — a guard against stuck loops.",
    spec: { kind: "number", placeholder: "5" },
  },
];
