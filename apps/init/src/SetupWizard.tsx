import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Select, TextInput, ConfirmInput } from "@inkjs/ui";
import { buildWorkflowMarkdown, type SetupMode, type WizardAnswers } from "@ralphy/workflow/wizard";

type FieldSpec =
  | { kind: "text"; placeholder?: string }
  | { kind: "number"; placeholder?: string }
  | { kind: "select"; options: { label: string; value: string }[]; defaultValue: string }
  | { kind: "confirm"; defaultChoice: "confirm" | "cancel" };

interface Field {
  /** Dotted path into WizardAnswers (at most two levels). */
  id: string;
  label: string;
  hint?: string;
  spec: FieldSpec;
}

const MODE_OPTIONS = [
  { label: "Quick — sensible defaults, only a few questions", value: "quick" },
  { label: "Permissive — defaults + auto-PR / auto-merge / CI auto-fix", value: "permissive" },
  { label: "Customized — walk through every setting group", value: "customized" },
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
  spec: { kind: "text" },
};
const LINEAR_ASSIGNEE: Field = {
  id: "linear.assignee",
  label: "Linear assignee",
  hint: "user id, email, or 'me' — blank for unassigned",
  spec: { kind: "text" },
};
const LINEAR_INDICATORS: Field = {
  id: "linear.indicatorsPreset",
  label: "Linear lifecycle indicators",
  spec: {
    kind: "select",
    defaultValue: "none",
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
      defaultValue: "claude",
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
      defaultValue: "opus",
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

interface SetupWizardProps {
  /** Called with the finished WORKFLOW.md string. The host writes the file. */
  onComplete: (markdown: string) => void;
  /** Called when the user aborts (Esc) before finishing. */
  onCancel?: () => void;
}

export function SetupWizard({ onComplete, onCancel }: SetupWizardProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<SetupMode | null>(null);
  const [index, setIndex] = useState(0);
  const [answers] = useState<Record<string, unknown>>(() => ({}));

  useInput((_input, key) => {
    if (key.escape) {
      onCancel?.();
      exit();
    }
  });

  if (mode === null) {
    return (
      <Box flexDirection="column">
        <Text bold>Ralphy setup — no WORKFLOW.md found</Text>
        <Text dimColor>Choose a setup mode (Esc to cancel):</Text>
        <Box marginTop={1}>
          <Select options={MODE_OPTIONS} onChange={(value) => setMode(value as SetupMode)} />
        </Box>
      </Box>
    );
  }

  const fields = fieldsForMode(mode);

  const advance = (field: Field, raw: string, kind: FieldSpec["kind"]): void => {
    if (kind === "text" || kind === "select") {
      const trimmed = raw.trim();
      if (trimmed !== "") setPath(answers, field.id, trimmed);
    } else if (kind === "number") {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(parsed)) setPath(answers, field.id, parsed);
    } else {
      // confirm: raw is "true" | "false"
      setPath(answers, field.id, raw === "true");
    }
    const next = index + 1;
    if (next >= fields.length) {
      onComplete(buildWorkflowMarkdown(assembleAnswers(mode, answers)));
      exit();
      return;
    }
    setIndex(next);
  };

  const field = fields[index]!;
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {mode} setup — step {index + 1}/{fields.length}
      </Text>
      <Box marginTop={1}>
        <Text bold>{field.label}</Text>
        {field.hint ? <Text dimColor> ({field.hint})</Text> : null}
      </Box>
      <Box marginTop={1}>
        {/* key forces a fresh input per step so prior values don't carry over. */}
        <FieldInput
          key={index}
          field={field}
          onAnswer={(raw) => advance(field, raw, field.spec.kind)}
        />
      </Box>
    </Box>
  );
}

function FieldInput({ field, onAnswer }: { field: Field; onAnswer: (raw: string) => void }) {
  const { spec } = field;
  switch (spec.kind) {
    case "text":
    case "number":
      return (
        <TextInput placeholder={spec.placeholder ?? ""} onSubmit={(value) => onAnswer(value)} />
      );
    case "select":
      return (
        <Select
          options={spec.options}
          defaultValue={spec.defaultValue}
          onChange={(value) => onAnswer(value)}
        />
      );
    case "confirm":
      return (
        <ConfirmInput
          defaultChoice={spec.defaultChoice}
          onConfirm={() => onAnswer("true")}
          onCancel={() => onAnswer("false")}
        />
      );
  }
}
