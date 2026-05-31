import { useState, type ReactNode } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  buildWorkflowMarkdown,
  indicatorsForPreset,
  type IndicatorMap,
  type IndicatorMarker,
  type SetupMode,
  type WizardAnswers,
  type WizardValue,
} from "@ralphy/workflow/wizard";
import {
  fieldsForMode,
  PROMPT_BODY_FIELD_ID,
  type Field,
  type FieldSpec,
} from "@ralphy/workflow/fields";

interface Option {
  label: string;
  value: string;
}

const MODE_OPTIONS: Option[] = [
  { label: "Quick — sensible defaults, only a few questions", value: "quick" },
  { label: "Permissive — defaults + auto-PR / auto-merge / CI auto-fix", value: "permissive" },
  { label: "Customized — walk through every setting group", value: "customized" },
];

const INDICATOR_OPTIONS: Option[] = [
  { label: "None — configure later in WORKFLOW.md", value: "none" },
  { label: "Status-based (Todo → In Progress → In Review)", value: "status-standard" },
  { label: "Label-based (ralph:todo / in-progress / done)", value: "label-standard" },
  { label: "Custom — build markers per lifecycle slot", value: "custom" },
];

const CONFIRM_OPTIONS: Option[] = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
];

/** Answers are keyed by field id (a dotted frontmatter path). */
type Answers = Record<string, WizardValue>;

/** Wrap collected answers into the builder's input shape. */
export function assembleAnswers(mode: SetupMode, values: Answers): WizardAnswers {
  return { mode, values };
}

/** Convert the indicators answer (preset string or custom map) to a map. */
function resolveIndicators(value: WizardValue | undefined): IndicatorMap | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return value === "none"
      ? undefined
      : indicatorsForPreset(value as "status-standard" | "label-standard");
  }
  return value as IndicatorMap;
}

function buildFromAnswers(
  mode: SetupMode,
  answers: Answers,
  build: (answers: WizardAnswers, bodyOverride?: string) => string = buildWorkflowMarkdown,
): string {
  const values: Answers = { ...answers };
  if ("linear.indicators" in values) {
    const indicators = resolveIndicators(values["linear.indicators"]);
    if (indicators) values["linear.indicators"] = indicators;
    else delete values["linear.indicators"];
  }
  // The prompt body is not a frontmatter setting — pull it out and pass it as
  // the body override instead of writing it as a key.
  let bodyOverride: string | undefined;
  if (PROMPT_BODY_FIELD_ID in values) {
    const body = values[PROMPT_BODY_FIELD_ID];
    if (typeof body === "string") bodyOverride = body;
    delete values[PROMPT_BODY_FIELD_ID];
  }
  return build(assembleAnswers(mode, values), bodyOverride);
}

function optionsFor(field: Field): Option[] {
  if (field.spec.kind === "select" || field.spec.kind === "multiselect") return field.spec.options;
  if (field.spec.kind === "indicators") return INDICATOR_OPTIONS;
  return CONFIRM_OPTIONS;
}

/** Human-readable rendering of an answer for the history list. */
function formatAnswer(field: Field, value: WizardValue | undefined): string {
  if (field.spec.kind === "indicators") {
    if (value === undefined || value === "none") return "none";
    if (typeof value === "string") {
      return optionsFor(field).find((o) => o.value === value)?.label ?? value;
    }
    return `custom (${Object.keys(value).length} slot(s))`;
  }
  if (value === undefined) {
    if (field.emptyLabel) return field.emptyLabel;
    if (field.spec.kind === "text" || field.spec.kind === "number") {
      return field.spec.placeholder ?? "(skipped)";
    }
    if (field.spec.kind === "list" || field.spec.kind === "multiselect") return "(none)";
    return "(skipped)";
  }
  if (field.spec.kind === "confirm") return value ? "Yes" : "No";
  if (field.spec.kind === "select") {
    return optionsFor(field).find((o) => o.value === value)?.label ?? String(value);
  }
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  return String(value);
}

interface EditingState {
  draft: string;
  optionIndex: number;
  listItems: string[];
  selected: Set<string>;
}

function computeEditing(
  field: Field,
  stored: WizardValue | undefined,
  multilineFallback = "",
): EditingState {
  const textLike = field.spec.kind === "text" || field.spec.kind === "number";
  return {
    draft:
      textLike && stored !== undefined
        ? String(stored)
        : field.spec.kind === "multiline"
          ? typeof stored === "string"
            ? stored
            : multilineFallback
          : "",
    optionIndex: initialOptionIndex(field, stored),
    listItems: field.spec.kind === "list" && Array.isArray(stored) ? [...stored] : [],
    selected:
      field.spec.kind === "multiselect" && Array.isArray(stored) ? new Set(stored) : new Set(),
  };
}

function initialOptionIndex(field: Field, stored: WizardValue | undefined): number {
  const options = optionsFor(field);
  if (field.spec.kind === "confirm") {
    if (stored === undefined) return field.spec.defaultChoice === "confirm" ? 0 : 1;
    return stored ? 0 : 1;
  }
  if (field.spec.kind === "indicators") {
    if (stored === undefined || stored === "none") return 0;
    if (typeof stored === "string") {
      const found = options.findIndex((o) => o.value === stored);
      return found < 0 ? 0 : found;
    }
    return options.findIndex((o) => o.value === "custom"); // a custom map
  }
  if (stored === undefined) return 0;
  const found = options.findIndex((o) => o.value === stored);
  return found < 0 ? 0 : found;
}

interface SetupWizardProps {
  onComplete: (markdown: string) => void;
  onCancel?: () => void;
  initialMode?: SetupMode;
  initialValues?: Answers;
  buildMarkdown?: (answers: WizardAnswers, bodyOverride?: string) => string;
  /** Migration diff path: only ask these field ids (their `when` gates still apply). */
  onlyFields?: string[];
  /** Current prompt-body text, pre-filled into the "customize prompt" step. */
  initialBody?: string;
}

export function SetupWizard({
  onComplete,
  onCancel,
  initialMode,
  initialValues,
  buildMarkdown,
  onlyFields,
  initialBody,
}: SetupWizardProps) {
  const { exit } = useApp();
  const startValues = initialValues ?? {};
  const bodyFallback = initialBody ?? "";
  const fieldsFor = (mode: SetupMode, answers: Answers): Field[] =>
    fieldsForMode(mode, answers, onlyFields);
  const startFields = initialMode ? fieldsFor(initialMode, startValues) : [];
  const startEditing = startFields[0]
    ? computeEditing(startFields[0]!, startValues[startFields[0]!.id], bodyFallback)
    : null;

  const [mode, setMode] = useState<SetupMode | null>(initialMode ?? null);
  const [modeIndex, setModeIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(startFields.map((f) => f.id)));
  const [answers, setAnswers] = useState<Answers>(startValues);
  const [draft, setDraft] = useState(startEditing?.draft ?? "");
  const [optionIndex, setOptionIndex] = useState(startEditing?.optionIndex ?? 0);
  const [listItems, setListItems] = useState<string[]>(startEditing?.listItems ?? []);
  const [selected, setSelected] = useState<Set<string>>(startEditing?.selected ?? new Set());
  const [building, setBuilding] = useState(false);

  const fields = mode ? fieldsFor(mode, answers) : [];
  const lastIndex = fields.length - 1;
  const field = fields[index];

  const initEditing = (next: Field, source: Answers): void => {
    const editing = computeEditing(next, source[next.id], bodyFallback);
    setDraft(editing.draft);
    setOptionIndex(editing.optionIndex);
    setListItems(editing.listItems);
    setSelected(editing.selected);
  };

  const valueForCommit = (target: Field): WizardValue | undefined => {
    const { spec } = target;
    if (spec.kind === "text") return draft.trim() === "" ? undefined : draft.trim();
    if (spec.kind === "number") {
      const parsed = Number.parseInt(draft.trim(), 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (spec.kind === "confirm") return optionIndex === 0;
    if (spec.kind === "select") return spec.options[optionIndex]!.value;
    if (spec.kind === "list") return listItems.length ? [...listItems] : undefined;
    if (spec.kind === "multiselect") return selected.size ? [...selected] : undefined;
    if (spec.kind === "multiline") return draft;
    // indicators handled separately (never reaches here)
    return undefined;
  };

  const commitCurrent = (): Answers => {
    if (!field) return answers;
    const next: Answers = { ...answers };
    if (field.spec.kind === "indicators") {
      const value = INDICATOR_OPTIONS[optionIndex]!.value;
      if (value === "custom") return next; // committed by the builder, not here
      if (value === "none") delete next["linear.indicators"];
      else next["linear.indicators"] = value;
      return next;
    }
    const value = valueForCommit(field);
    if (value === undefined) delete next[field.id];
    else next[field.id] = value;
    return next;
  };

  const goTo = (target: number, source: Answers): void => {
    setAnswers(source);
    setIndex(target);
    initEditing(fieldsFor(mode!, source)[target]!, source);
  };

  // In diff mode we prefill every config value so gating works, but only the
  // diff fields should be written back — otherwise a sparse legacy file gains a
  // cluster of materialized defaults it never asked for.
  const valuesToWrite = (source: Answers): Answers =>
    onlyFields
      ? Object.fromEntries(Object.entries(source).filter(([id]) => onlyFields.includes(id)))
      : source;

  const advance = (source: Answers): void => {
    const nextFields = fieldsFor(mode!, source);
    if (index >= nextFields.length - 1) {
      onComplete(buildFromAnswers(mode!, valuesToWrite(source), buildMarkdown));
      exit();
      return;
    }
    setVisited((prev) => new Set(prev).add(nextFields[index + 1]!.id));
    goTo(index + 1, source);
  };

  useInput(
    (input, key) => {
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
          setVisited(new Set([fieldsFor(chosen, answers)[0]!.id]));
          initEditing(fieldsFor(chosen, answers)[0]!, answers);
        }
        return;
      }

      const current = fields[index]!;

      // Multiline (prompt body) captures all keys: type to edit, Enter inserts
      // a newline, Ctrl-D finishes. Esc (handled above) cancels the wizard.
      if (current.spec.kind === "multiline") {
        if (key.ctrl && input === "d") {
          advance(commitCurrent());
        } else if (key.return) {
          setDraft(`${draft}\n`);
        } else if (key.backspace || key.delete) {
          setDraft(draft.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta && !key.tab) {
          setDraft(draft + input);
        }
        return;
      }

      const isOption =
        current.spec.kind === "select" ||
        current.spec.kind === "confirm" ||
        current.spec.kind === "indicators" ||
        current.spec.kind === "multiselect";

      // Up/Down move option highlight.
      if (key.upArrow || key.downArrow) {
        if (isOption) {
          const length = optionsFor(current).length;
          setOptionIndex((optionIndex + (key.upArrow ? length - 1 : 1)) % length);
        }
        return;
      }

      // Left/Right move between questions (forward only into visited ones).
      if (key.leftArrow) {
        if (index > 0) goTo(index - 1, commitCurrent());
        return;
      }
      if (key.rightArrow) {
        const committed = commitCurrent();
        const nextField = fieldsFor(mode, committed)[index + 1];
        if (index < lastIndex && nextField && visited.has(nextField.id)) {
          goTo(index + 1, committed);
        }
        return;
      }

      // multiselect: space toggles the highlighted option.
      if (current.spec.kind === "multiselect" && input === " ") {
        const value = current.spec.options[optionIndex]!.value;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          return next;
        });
        return;
      }

      if (key.return) {
        if (
          current.spec.kind === "indicators" &&
          INDICATOR_OPTIONS[optionIndex]!.value === "custom"
        ) {
          setBuilding(true);
          return;
        }
        if (current.spec.kind === "list" && draft.trim() !== "") {
          setListItems((prev) => [...prev, draft.trim()]);
          setDraft("");
          return;
        }
        advance(commitCurrent());
        return;
      }

      if (isOption) return; // typing ignored on option fields

      // text / number / list editing
      if (key.backspace || key.delete) {
        setDraft(draft.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.tab) {
        setDraft(draft + input);
      }
    },
    { isActive: !building },
  );

  if (mode === null) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan">◆ </Text>
          <Text bold>Ralphy setup</Text>
        </Text>
        <Text dimColor>{"  "}No WORKFLOW.md found — choose a setup mode</Text>
        <Box marginTop={1} marginLeft={2}>
          <OptionList options={MODE_OPTIONS} highlight={modeIndex} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ to move · enter to confirm and continue · esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  if (building && field) {
    return (
      <IndicatorBuilder
        slots={activeSlots(answers)}
        onDone={(map) => {
          const next: Answers = { ...answers };
          if (Object.keys(map).length > 0) next["linear.indicators"] = map;
          else delete next["linear.indicators"];
          setBuilding(false);
          advance(next);
        }}
        onCancel={() => setBuilding(false)}
      />
    );
  }

  if (!field) return null;
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text>
        <Text color="cyan">◆ </Text>
        <Text bold>Ralphy setup</Text>
        <Text dimColor>
          {"  ·  "}
          {mode} · step {index + 1}/{fields.length}
        </Text>
      </Text>

      {/* What's been answered so far */}
      <AnsweredHistory fields={fields} answers={answers} upTo={index} />

      {/* Current question: title → description → space → input */}
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="cyan">? </Text>
          <Text bold>{field.label}</Text>
        </Text>
        {field.description ? (
          <Text dimColor>
            {"  "}
            {field.description}
          </Text>
        ) : null}
        {field.hint ? (
          <Text dimColor>
            {"  "}
            {field.hint}
          </Text>
        ) : null}
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          <QuestionInput
            field={field}
            draft={draft}
            optionIndex={optionIndex}
            listItems={listItems}
            selected={selected}
          />
        </Box>
      </Box>

      {/* Footer controls */}
      <Box marginTop={1}>
        <Text dimColor>{hintFor(field.spec.kind)}</Text>
      </Box>
    </Box>
  );
}

function hintFor(kind: FieldSpec["kind"]): string {
  const nav = "← prev · → next · esc cancel";
  if (kind === "select" || kind === "confirm" || kind === "indicators") {
    return `↑↓ to switch · enter to confirm and continue · ${nav}`;
  }
  if (kind === "multiselect") {
    return `↑↓ to move · space to toggle · enter to confirm and continue · ${nav}`;
  }
  if (kind === "list") {
    return `type + enter to add · empty enter to finish · ${nav}`;
  }
  if (kind === "multiline") {
    return "type to edit · enter for a new line · Ctrl-D to finish · esc cancel";
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

/** Renders only the interactive part of a question (options or text input). */
function QuestionInput({
  field,
  draft,
  optionIndex,
  listItems,
  selected,
}: {
  field: Field;
  draft: string;
  optionIndex: number;
  listItems: string[];
  selected: Set<string>;
}) {
  if (
    field.spec.kind === "select" ||
    field.spec.kind === "confirm" ||
    field.spec.kind === "indicators"
  ) {
    return <OptionList options={optionsFor(field)} highlight={optionIndex} />;
  }
  if (field.spec.kind === "multiselect") {
    return (
      <Box flexDirection="column">
        {field.spec.options.map((option, i) => (
          <Text key={option.value} {...(i === optionIndex ? { color: "green" } : {})}>
            {i === optionIndex ? "❯ " : "  "}[{selected.has(option.value) ? "x" : " "}]{" "}
            {option.label}
          </Text>
        ))}
      </Box>
    );
  }
  if (field.spec.kind === "list") {
    return (
      <Box flexDirection="column">
        {listItems.map((item, i) => (
          <Text key={i} color="green">
            • {item}
          </Text>
        ))}
        <Box>
          <Text color="green">{"❯ "}</Text>
          {draft ? <Text>{draft}</Text> : <Text dimColor>{field.spec.placeholder ?? ""}</Text>}
          <Text inverse> </Text>
        </Box>
      </Box>
    );
  }
  if (field.spec.kind === "multiline") {
    const lines = draft.split("\n");
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {lines.map((line, i) => (
          <Text key={i}>
            {line === "" ? " " : line}
            {i === lines.length - 1 ? <Text inverse> </Text> : null}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box>
      <Text color="green">{"❯ "}</Text>
      {draft ? <Text>{draft}</Text> : <Text dimColor>{field.spec.placeholder ?? ""}</Text>}
      <Text inverse> </Text>
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
      <Text key={field.id}>
        <Text color="green">✓ </Text>
        <Text dimColor>{field.label}</Text>
        <Text dimColor>{"  "}</Text>
        <Text color="cyan">{formatAnswer(field, answers[field.id])}</Text>
      </Text>,
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows}
    </Box>
  );
}

/**
 * Generic single-choice prompt: a cyan ◆ title, a dim subtitle, optional
 * details, a navigable option list, and a footer. Esc resolves to the LAST
 * option (always the exit/cancel choice). All `ralphy init` decision screens
 * are thin wrappers over this so they stay visually consistent.
 */
function ChoicePrompt<Value extends string>({
  title,
  subtitle,
  details,
  options,
  onChoice,
}: {
  title: ReactNode;
  subtitle: string;
  details?: ReactNode;
  options: { label: string; value: Value }[];
  onChoice: (value: Value) => void;
}) {
  const { exit } = useApp();
  const [choiceIndex, setChoiceIndex] = useState(0);
  const escValue = options[options.length - 1]!.value;
  useInput((_input, key) => {
    if (key.escape) {
      onChoice(escValue);
      exit();
      return;
    }
    if (key.upArrow) {
      setChoiceIndex((choiceIndex + options.length - 1) % options.length);
    } else if (key.downArrow) {
      setChoiceIndex((choiceIndex + 1) % options.length);
    } else if (key.return) {
      onChoice(options[choiceIndex]!.value);
      exit();
    }
  });
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">◆ </Text>
        <Text bold>{title}</Text>
      </Text>
      <Text dimColor>
        {"  "}
        {subtitle}
      </Text>
      {details ? (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {details}
        </Box>
      ) : null}
      <Box marginTop={1} marginLeft={2}>
        <OptionList options={options} highlight={choiceIndex} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ to move · enter to choose · esc to exit</Text>
      </Box>
    </Box>
  );
}

const EDIT_EXIT_OPTIONS: { label: string; value: "edit" | "exit" }[] = [
  { label: "Edit it with the setup wizard", value: "edit" },
  { label: "Exit without changes", value: "exit" },
];

/** Shown by `ralphy init` when WORKFLOW.md already exists and is valid. */
export function EditOrExitPrompt({ onChoice }: { onChoice: (choice: "edit" | "exit") => void }) {
  return (
    <ChoicePrompt
      title="WORKFLOW.md already exists"
      subtitle="Choose what to do"
      options={EDIT_EXIT_OPTIONS}
      onChoice={onChoice}
    />
  );
}

const RECREATE_EXIT_OPTIONS: { label: string; value: "recreate" | "exit" }[] = [
  { label: "Recreate it from scratch with the setup wizard", value: "recreate" },
  { label: "Exit and leave the file unchanged", value: "exit" },
];

/** Shown by `ralphy init` when WORKFLOW.md exists but can't be parsed. */
export function RecreateOrExitPrompt({
  onChoice,
}: {
  onChoice: (choice: "recreate" | "exit") => void;
}) {
  return (
    <ChoicePrompt
      title="WORKFLOW.md is invalid"
      subtitle="It can't be read (missing or malformed YAML frontmatter)"
      options={RECREATE_EXIT_OPTIONS}
      onChoice={onChoice}
    />
  );
}

export type MigrateChoice = "diff" | "all" | "exit";

const MIGRATE_OPTIONS: { label: string; value: MigrateChoice }[] = [
  { label: "Fill in only the new settings", value: "diff" },
  { label: "Review every setting", value: "all" },
  { label: "Exit without changes", value: "exit" },
];

/**
 * Shown by `ralphy init` when an existing WORKFLOW.md is behind the current
 * schema version. Lists what each pending version introduced, then offers to
 * fill in just the new settings, review everything, or exit.
 */
export function MigratePrompt({
  fromVersion,
  toVersion,
  descriptions,
  onChoice,
}: {
  fromVersion: number;
  toVersion: number;
  descriptions: string[];
  onChoice: (choice: MigrateChoice) => void;
}) {
  return (
    <ChoicePrompt
      title={`WORKFLOW.md is out of date (v${fromVersion} → v${toVersion})`}
      subtitle="Migrate it to the current schema"
      details={
        <>
          <Text dimColor>What changed</Text>
          {descriptions.map((description, i) => (
            <Text key={i} dimColor>
              {"  • "}
              {description}
            </Text>
          ))}
        </>
      }
      options={MIGRATE_OPTIONS}
      onChoice={onChoice}
    />
  );
}

// ─── Custom indicator builder ───────────────────────────────────────────────

const CORE_SLOTS = [
  "getTodo",
  "getInProgress",
  "setInProgress",
  "setDone",
  "setError",
  "getAutoMerge",
] as const;
const CONFIRMATION_SLOTS = [
  "getConfirmGate",
  "getAutoApprove",
  "getApproved",
  "clearApproved",
  "setAwaitingConfirmation",
  "clearAwaitingConfirmation",
] as const;

/** Which slots the builder walks — core lifecycle plus gate slots when enabled. */
function activeSlots(answers: Answers): string[] {
  const slots: string[] = [...CORE_SLOTS];
  if (answers["linear.confirmationMode.enabled"] === true) slots.push(...CONFIRMATION_SLOTS);
  return slots;
}

type SlotCategory = "get" | "set" | "clear";
function categoryOf(slot: string): SlotCategory {
  if (slot.startsWith("get")) return "get";
  if (slot.startsWith("clear")) return "clear";
  return "set";
}

function typeOptionsFor(slot: string): Option[] {
  const category = categoryOf(slot);
  const all: Option[] = [
    { label: "status", value: "status" },
    { label: "label", value: "label" },
    { label: "project", value: "project" },
    { label: "attachment", value: "attachment" },
    { label: "comment", value: "comment" },
  ];
  if (category === "get") return all;
  if (category === "set") return all.filter((o) => o.value !== "comment");
  return all.filter((o) => o.value === "label" || o.value === "comment"); // clear
}

function buildIndicatorMap(markers: Record<string, IndicatorMarker[]>): IndicatorMap {
  const map: IndicatorMap = {};
  for (const [slot, list] of Object.entries(markers)) {
    if (!list.length) continue;
    if (categoryOf(slot) === "get") map[slot] = { filter: list };
    else map[slot] = list.length === 1 ? list[0]! : list;
  }
  return map;
}

export function IndicatorBuilder({
  slots,
  onDone,
  onCancel,
}: {
  slots: string[];
  onDone: (map: IndicatorMap) => void;
  onCancel: () => void;
}) {
  const [slotIndex, setSlotIndex] = useState(0);
  const [phase, setPhase] = useState<"type" | "value" | "group">("type");
  const [typeIndex, setTypeIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [pendingType, setPendingType] = useState("");
  const [pendingValue, setPendingValue] = useState("");
  const [markers, setMarkers] = useState<Record<string, IndicatorMarker[]>>({});

  const slot = slots[slotIndex];
  const typeChoices: Option[] = slot
    ? [...typeOptionsFor(slot), { label: "✓ done with this slot", value: "__done" }]
    : [];

  const nextSlot = (): void => {
    if (slotIndex >= slots.length - 1) {
      onDone(buildIndicatorMap(markers));
      return;
    }
    setSlotIndex(slotIndex + 1);
    setPhase("type");
    setTypeIndex(0);
    setDraft("");
  };

  const addMarker = (marker: IndicatorMarker): void => {
    setMarkers((prev) => ({ ...prev, [slot!]: [...(prev[slot!] ?? []), marker] }));
    setPhase("type");
    setTypeIndex(0);
    setDraft("");
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (!slot) return;

    if (phase === "type") {
      if (key.upArrow) setTypeIndex((typeIndex + typeChoices.length - 1) % typeChoices.length);
      else if (key.downArrow) setTypeIndex((typeIndex + 1) % typeChoices.length);
      else if (key.return) {
        const choice = typeChoices[typeIndex]!.value;
        if (choice === "__done") nextSlot();
        else {
          setPendingType(choice);
          setPhase("value");
          setDraft("");
        }
      }
      return;
    }

    // value / group text entry
    if (key.return) {
      const text = draft.trim();
      if (phase === "value") {
        if (text === "") return; // value is required
        if (pendingType === "label") {
          setPendingValue(text);
          setPhase("group");
          setDraft("");
        } else {
          addMarker({ type: pendingType as IndicatorMarker["type"], value: text });
        }
      } else {
        // group (optional, label only)
        addMarker(
          text === ""
            ? { type: "label", value: pendingValue }
            : { type: "label", value: pendingValue, group: text },
        );
      }
      return;
    }
    if (key.backspace || key.delete) {
      setDraft(draft.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab) setDraft(draft + input);
  });

  if (!slot) return null;
  const existing = markers[slot] ?? [];
  return (
    <Box flexDirection="column">
      <Text bold>
        Custom indicators — {slot} ({categoryOf(slot)})
      </Text>
      <Text dimColor>
        slot {slotIndex + 1}/{slots.length}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {existing.map((marker, i) => (
          <Text key={i} color="green">
            • {marker.type}: {marker.group ? `${marker.group}:${marker.value}` : marker.value}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {phase === "type" ? (
          <>
            <Text>Add a marker (or finish this slot):</Text>
            <OptionList options={typeChoices} highlight={typeIndex} />
            <Text dimColor>↑↓ to move · enter to choose · esc to cancel</Text>
          </>
        ) : (
          <>
            <Box>
              <Text bold>
                {phase === "value" ? `${pendingType} value` : "label group (optional)"}:{" "}
              </Text>
              <Text>{draft}</Text>
              <Text inverse> </Text>
            </Box>
            <Text dimColor>
              type a value · enter to confirm{phase === "group" ? " (blank = no group)" : ""}
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}
