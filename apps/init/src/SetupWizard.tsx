import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { buildWorkflowMarkdown, type SetupMode, type WizardAnswers } from "@ralphy/workflow/wizard";

type FieldSpec =
  | { kind: "text"; placeholder?: string }
  | { kind: "number"; placeholder?: string }
  | { kind: "select"; options: { label: string; value: string }[] }
  | { kind: "confirm"; defaultChoice: "confirm" | "cancel" };

interface Field {
  /** Dotted path into WizardAnswers (at most two levels). */
  id: string;
  label: string;
  hint?: string;
  /** What to display in the history when the field is left blank. */
  emptyLabel?: string;
  spec: FieldSpec;
}

interface Option {
  label: string;
  value: string;
}

const MODE_OPTIONS: Option[] = [
  { label: "Quick — sensible defaults, only a few questions", value: "quick" },
  { label: "Permissive — defaults + auto-PR / auto-merge / CI auto-fix", value: "permissive" },
  { label: "Customized — walk through every setting group", value: "customized" },
];

const CONFIRM_OPTIONS: Option[] = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
];

const PROJECT_NAME: Field = {
  id: "project.name",
  label: "Project name",
  spec: { kind: "text", placeholder: "my-project" },
};
const LINEAR_TEAM: Field = {
  id: "linear.team",
  label: "Linear team key",
  hint: "e.g. ENG — leave blank to match all teams",
  emptyLabel: "all teams",
  spec: { kind: "text" },
};
const LINEAR_ASSIGNEE: Field = {
  id: "linear.assignee",
  label: "Linear assignee",
  hint: "user id, email, or 'me' — blank for unassigned",
  emptyLabel: "unassigned",
  spec: { kind: "text" },
};
const LINEAR_INDICATORS: Field = {
  id: "linear.indicatorsPreset",
  label: "Linear lifecycle indicators",
  spec: {
    kind: "select",
    options: [
      { label: "None — configure later in WORKFLOW.md", value: "none" },
      { label: "Status-based (Todo → In Progress → In Review)", value: "status-standard" },
      { label: "Label-based (ralph:todo / in-progress / done)", value: "label-standard" },
    ],
  },
};

const QUICK_FIELDS: Field[] = [PROJECT_NAME, LINEAR_TEAM, LINEAR_ASSIGNEE];

const CUSTOMIZED_FIELDS: Field[] = [
  PROJECT_NAME,
  { id: "project.language", label: "Language", spec: { kind: "text", placeholder: "TypeScript" } },
  { id: "project.framework", label: "Framework", spec: { kind: "text", placeholder: "Bun + Nx" } },
  { id: "commands.test", label: "Test command", spec: { kind: "text", placeholder: "bun test" } },
  {
    id: "commands.lint",
    label: "Lint command",
    spec: { kind: "text", placeholder: "bun run lint" },
  },
  {
    id: "commands.build",
    label: "Build command",
    spec: { kind: "text", placeholder: "bun run build" },
  },
  {
    id: "commands.typecheck",
    label: "Typecheck command",
    spec: { kind: "text", placeholder: "bun run typecheck" },
  },
  {
    id: "engine",
    label: "Engine",
    spec: {
      kind: "select",
      options: [
        { label: "claude", value: "claude" },
        { label: "codex", value: "codex" },
      ],
    },
  },
  {
    id: "model",
    label: "Model tier",
    spec: {
      kind: "select",
      options: [
        { label: "opus", value: "opus" },
        { label: "sonnet", value: "sonnet" },
        { label: "haiku", value: "haiku" },
      ],
    },
  },
  {
    id: "concurrency",
    label: "Concurrency (parallel tasks)",
    spec: { kind: "number", placeholder: "1" },
  },
  {
    id: "createPrOnSuccess",
    label: "Open a pull request when a task succeeds?",
    spec: { kind: "confirm", defaultChoice: "cancel" },
  },
  { id: "prBaseBranch", label: "PR base branch", spec: { kind: "text", placeholder: "main" } },
  {
    id: "fixCiOnFailure",
    label: "Let the agent attempt to fix CI failures?",
    spec: { kind: "confirm", defaultChoice: "cancel" },
  },
  {
    id: "useWorktree",
    label: "Run each task in an isolated git worktree?",
    spec: { kind: "confirm", defaultChoice: "cancel" },
  },
  LINEAR_TEAM,
  LINEAR_ASSIGNEE,
  LINEAR_INDICATORS,
];

export function fieldsForMode(mode: SetupMode): Field[] {
  return mode === "customized" ? CUSTOMIZED_FIELDS : QUICK_FIELDS;
}

type AnswerValue = string | number | boolean;
type Answers = Record<number, AnswerValue>;

/** The options shown for a select/confirm field. */
function optionsFor(field: Field): Option[] {
  if (field.spec.kind === "select") return field.spec.options;
  return CONFIRM_OPTIONS;
}

/** Set a one- or two-level dotted path on a plain record. */
function setPath(target: Record<string, unknown>, path: string, value: AnswerValue): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    target[parts[0]!] = value;
    return;
  }
  const [head, leaf] = parts as [string, string];
  const child = (target[head] as Record<string, unknown> | undefined) ?? {};
  child[leaf] = value;
  target[head] = child;
}

/**
 * Assemble the collected answers into the WizardAnswers shape. The collected
 * record already mirrors the dotted ids, so we only need to attach the mode.
 */
export function assembleAnswers(
  mode: SetupMode,
  collected: Record<string, unknown>,
): WizardAnswers {
  return { mode, ...collected } as WizardAnswers;
}

/** Turn the per-step answer map into the final WORKFLOW.md string. */
function buildFromAnswers(
  mode: SetupMode,
  fields: Field[],
  answers: Answers,
  build: (answers: WizardAnswers) => string = buildWorkflowMarkdown,
): string {
  const collected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    const field = fields[Number(key)];
    if (field) setPath(collected, field.id, value);
  }
  return build(assembleAnswers(mode, collected));
}

/** Human-readable rendering of a recorded answer for the history list. */
function formatAnswer(field: Field, value: AnswerValue | undefined): string {
  if (value === undefined) {
    // A field-specific word (e.g. "unassigned") wins; otherwise fall back to
    // the schema default the placeholder advertises.
    if (field.emptyLabel) return field.emptyLabel;
    if (field.spec.kind === "text" || field.spec.kind === "number") {
      return field.spec.placeholder ?? "(skipped)";
    }
    return "(skipped)";
  }
  if (field.spec.kind === "confirm") return value ? "Yes" : "No";
  if (field.spec.kind === "select") {
    return field.spec.options.find((option) => option.value === value)?.label ?? String(value);
  }
  return String(value);
}

/** Highlighted option index when (re)entering a select/confirm field. */
function initialOptionIndex(field: Field, stored: AnswerValue | undefined): number {
  const options = optionsFor(field);
  if (field.spec.kind === "confirm") {
    if (stored === undefined) return field.spec.defaultChoice === "confirm" ? 0 : 1;
    return stored ? 0 : 1;
  }
  if (stored === undefined) return 0;
  const found = options.findIndex((option) => option.value === stored);
  return found < 0 ? 0 : found;
}

/** Map field-id keyed values onto the step-index keyed answers map. */
function indexedAnswers(mode: SetupMode, values: Record<string, AnswerValue>): Answers {
  const answers: Answers = {};
  fieldsForMode(mode).forEach((field, i) => {
    const value = values[field.id];
    if (value !== undefined) answers[i] = value;
  });
  return answers;
}

interface SetupWizardProps {
  /** Called with the finished WORKFLOW.md string. The host writes the file. */
  onComplete: (markdown: string) => void;
  /** Called when the user aborts (Esc) before finishing. */
  onCancel?: () => void;
  /** Start directly in this mode (skips the mode picker) — used when editing. */
  initialMode?: SetupMode;
  /** Field-id keyed values to prefill (used when editing an existing file). */
  initialValues?: Record<string, AnswerValue>;
  /** Override how answers become markdown (editing applies onto the existing file). */
  buildMarkdown?: (answers: WizardAnswers) => string;
}

export function SetupWizard({
  onComplete,
  onCancel,
  initialMode,
  initialValues,
  buildMarkdown,
}: SetupWizardProps) {
  const { exit } = useApp();
  const startFields = initialMode ? fieldsForMode(initialMode) : [];
  const startAnswers = initialMode ? indexedAnswers(initialMode, initialValues ?? {}) : {};
  const [mode, setMode] = useState<SetupMode | null>(initialMode ?? null);
  const [modeIndex, setModeIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(initialMode ? startFields.length - 1 : 0);
  const [answers, setAnswers] = useState<Answers>(startAnswers);
  const [draft, setDraft] = useState(() => {
    const first = startFields[0];
    if (first && (first.spec.kind === "text" || first.spec.kind === "number")) {
      return startAnswers[0] === undefined ? "" : String(startAnswers[0]);
    }
    return "";
  });
  const [optionIndex, setOptionIndex] = useState(() => {
    const first = startFields[0];
    if (first && (first.spec.kind === "select" || first.spec.kind === "confirm")) {
      return initialOptionIndex(first, startAnswers[0]);
    }
    return 0;
  });

  const fields = mode ? fieldsForMode(mode) : [];
  const lastIndex = fields.length - 1;

  /** Reset the transient editing state when (re)entering a step. */
  const initEditing = (field: Field, stored: AnswerValue | undefined): void => {
    if (field.spec.kind === "text" || field.spec.kind === "number") {
      setDraft(stored === undefined ? "" : String(stored));
      setOptionIndex(0);
    } else {
      setDraft("");
      setOptionIndex(initialOptionIndex(field, stored));
    }
  };

  /** Commit the current step's editing state into a fresh answers map. */
  const commitCurrent = (): Answers => {
    const next: Answers = { ...answers };
    const field = fields[index]!;
    const { spec } = field;
    if (spec.kind === "text") {
      const trimmed = draft.trim();
      if (trimmed === "") delete next[index];
      else next[index] = trimmed;
    } else if (spec.kind === "number") {
      const parsed = Number.parseInt(draft.trim(), 10);
      if (Number.isFinite(parsed)) next[index] = parsed;
      else delete next[index];
    } else if (spec.kind === "confirm") {
      next[index] = optionIndex === 0;
    } else {
      next[index] = spec.options[optionIndex]!.value;
    }
    return next;
  };

  const goTo = (target: number, src: Answers): void => {
    setAnswers(src);
    setIndex(target);
    initEditing(fields[target]!, src[target]);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      exit();
      return;
    }

    if (mode === null) {
      if (key.upArrow) setModeIndex((modeIndex + MODE_OPTIONS.length - 1) % MODE_OPTIONS.length);
      else if (key.downArrow) setModeIndex((modeIndex + 1) % MODE_OPTIONS.length);
      else if (key.return) {
        const chosen = MODE_OPTIONS[modeIndex]!.value as SetupMode;
        setMode(chosen);
        setIndex(0);
        initEditing(fieldsForMode(chosen)[0]!, undefined);
      }
      return;
    }

    const field = fields[index]!;
    const isOptionField = field.spec.kind === "select" || field.spec.kind === "confirm";

    // Up/Down switch the current question's options.
    if (key.upArrow || key.downArrow) {
      if (isOptionField) {
        const length = optionsFor(field).length;
        const delta = key.upArrow ? length - 1 : 1;
        setOptionIndex((optionIndex + delta) % length);
      }
      return;
    }

    // Left/Right move to the previous/next question (forward only into
    // questions already reached), committing the current edit first.
    if (key.leftArrow) {
      if (index > 0) goTo(index - 1, commitCurrent());
      return;
    }
    if (key.rightArrow) {
      if (index < lastIndex && index < maxVisited) goTo(index + 1, commitCurrent());
      return;
    }

    if (key.return) {
      const next = commitCurrent();
      if (index >= lastIndex) {
        onComplete(buildFromAnswers(mode, fields, next, buildMarkdown));
        exit();
      } else {
        setMaxVisited(Math.max(maxVisited, index + 1));
        goTo(index + 1, next);
      }
      return;
    }

    if (isOptionField) return; // typing is ignored on option fields

    // text / number editing
    if (key.backspace || key.delete) {
      setDraft(draft.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab) {
      setDraft(draft + input);
    }
  });

  if (mode === null) {
    return (
      <Box flexDirection="column">
        <Text bold>Ralphy setup — no WORKFLOW.md found</Text>
        <Text dimColor>Choose a setup mode:</Text>
        <Box marginTop={1}>
          <OptionList options={MODE_OPTIONS} highlight={modeIndex} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ to move · enter to confirm and continue · esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  const field = fields[index]!;
  return (
    <Box flexDirection="column">
      <AnsweredHistory fields={fields} answers={answers} upTo={index} />
      <Text dimColor>
        {mode} setup — step {index + 1}/{fields.length}
      </Text>
      <Box marginTop={1}>
        <CurrentQuestion field={field} draft={draft} optionIndex={optionIndex} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{hintFor(field.spec.kind)}</Text>
      </Box>
    </Box>
  );
}

function hintFor(kind: FieldSpec["kind"]): string {
  const nav = "← prev · → next · esc cancel";
  if (kind === "select" || kind === "confirm") {
    return `↑↓ to switch · enter to confirm and continue · ${nav}`;
  }
  return `type a value · enter to confirm and continue (blank to skip) · ${nav}`;
}

function OptionList({ options, highlight }: { options: Option[]; highlight: number }) {
  return (
    <Box flexDirection="column">
      {options.map((option, i) => (
        <Text key={option.value} {...(i === highlight ? { color: "green" } : {})}>
          {i === highlight ? "❯ " : "  "}
          {option.label}
        </Text>
      ))}
    </Box>
  );
}

function CurrentQuestion({
  field,
  draft,
  optionIndex,
}: {
  field: Field;
  draft: string;
  optionIndex: number;
}) {
  const heading = (
    <Text>
      <Text bold>{field.label}:</Text>
      {field.hint ? <Text dimColor> ({field.hint})</Text> : null}
    </Text>
  );
  if (field.spec.kind === "select" || field.spec.kind === "confirm") {
    return (
      <Box flexDirection="column">
        {heading}
        <OptionList options={optionsFor(field)} highlight={optionIndex} />
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{field.label}: </Text>
        {draft ? <Text>{draft}</Text> : <Text dimColor>{field.spec.placeholder ?? ""}</Text>}
        <Text inverse> </Text>
      </Box>
      {field.hint ? <Text dimColor> ({field.hint})</Text> : null}
    </Box>
  );
}

const EDIT_EXIT_OPTIONS: Option[] = [
  { label: "Edit it with the setup wizard", value: "edit" },
  { label: "Exit without changes", value: "exit" },
];

/** Shown by `ralphy init` when WORKFLOW.md already exists. */
export function EditOrExitPrompt({ onChoice }: { onChoice: (choice: "edit" | "exit") => void }) {
  const { exit } = useApp();
  const [choiceIndex, setChoiceIndex] = useState(0);
  useInput((_input, key) => {
    if (key.escape) {
      onChoice("exit");
      exit();
      return;
    }
    if (key.upArrow) {
      setChoiceIndex((choiceIndex + EDIT_EXIT_OPTIONS.length - 1) % EDIT_EXIT_OPTIONS.length);
    } else if (key.downArrow) {
      setChoiceIndex((choiceIndex + 1) % EDIT_EXIT_OPTIONS.length);
    } else if (key.return) {
      onChoice(EDIT_EXIT_OPTIONS[choiceIndex]!.value as "edit" | "exit");
      exit();
    }
  });
  return (
    <Box flexDirection="column">
      <Text bold>WORKFLOW.md already exists</Text>
      <Box marginTop={1}>
        <OptionList options={EDIT_EXIT_OPTIONS} highlight={choiceIndex} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ to move · enter to choose · esc to exit</Text>
      </Box>
    </Box>
  );
}

function AnsweredHistory({
  fields,
  answers,
  upTo,
}: {
  fields: Field[];
  answers: Answers;
  upTo: number;
}) {
  if (upTo <= 0) return null;
  const rows = [];
  for (let i = 0; i < upTo; i++) {
    const field = fields[i]!;
    rows.push(
      <Text key={i}>
        <Text dimColor>{field.label}: </Text>
        <Text color="green">{formatAnswer(field, answers[i])}</Text>
      </Text>,
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {rows}
    </Box>
  );
}
