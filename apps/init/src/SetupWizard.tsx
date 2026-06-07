import { useEffect, useState, type ReactNode } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { VERSION } from "@ralphy/version";
import { buildWorkflowMarkdown, indicatorsForPreset } from "@ralphy/workflow/wizard";
import type {
  IndicatorMap,
  IndicatorMarker,
  SetupMode,
  WizardAnswers,
  WizardValue,
} from "@ralphy/workflow/wizard-types";
import {
  fieldsForMode,
  LINEAR_ASSIGNEE_CHOICE_FIELD_ID,
  LINEAR_ASSIGNEE_VALUE_FIELD_ID,
  PROMPT_BODY_FIELD_ID,
  REPO_LINK_FIELD_ID,
  type Field,
  type FieldSpec,
} from "@ralphy/workflow/fields";

const REPO_ANSWER_IDS = ["repo.remote", "repo.host", "repo.owner", "repo.name"] as const;

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
  { label: "Status-based preset (Todo → In Progress → In Review)", value: "status-standard" },
  { label: "Label-based preset (ralph:todo / in-progress / done)", value: "label-standard" },
  { label: "Custom — open a guided builder (enter opens it)", value: "custom" },
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

export function buildFromAnswers(
  mode: SetupMode,
  answers: Answers,
  build: (answers: WizardAnswers, bodyOverride?: string) => string = buildWorkflowMarkdown,
): string {
  const values: Answers = { ...answers };
  // Concurrency > 1 requires isolated worktrees so parallel tasks don't share
  // (and clobber) one working copy. Force it on — the wizard hides the worktree
  // toggle once concurrency > 1, and the runtime enforces the same invariant.
  const concurrencyValue = values["concurrency"];
  if (typeof concurrencyValue === "number" && concurrencyValue > 1) {
    values["useWorktree"] = true;
  }
  // Compose the assignee select (+ optional specific-user value) into the single
  // `linear.filter` expression. The choice/value are control fields, never
  // written as frontmatter keys.
  const assigneeChoice = values[LINEAR_ASSIGNEE_CHOICE_FIELD_ID];
  if (typeof assigneeChoice === "string") {
    let assignee: string | undefined;
    if (assigneeChoice === "other") {
      const raw = values[LINEAR_ASSIGNEE_VALUE_FIELD_ID];
      assignee = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    } else {
      assignee = assigneeChoice; // me / any / unassigned
    }
    if (assignee) values["linear.filter"] = `assignee = ${assignee}`;
  }
  delete values[LINEAR_ASSIGNEE_CHOICE_FIELD_ID];
  delete values[LINEAR_ASSIGNEE_VALUE_FIELD_ID];
  if ("linear.indicators" in values) {
    const indicators = resolveIndicators(values["linear.indicators"]);
    if (indicators) values["linear.indicators"] = indicators;
    else delete values["linear.indicators"];
  }
  // When the confirmation gate is on, ensure the indicators carry an approval
  // signal. Without `getApproved` a human can never clear the gate (only the
  // timeout can) — and the preset paths don't include it. Add a sensible
  // `approved`-label default unless the custom editor already supplied one.
  // Only augments an indicators map already being written, so diff-mode runs
  // that don't touch indicators are untouched.
  if (
    values["linear.confirmationMode.enabled"] === true &&
    values["linear.indicators"] &&
    typeof values["linear.indicators"] === "object"
  ) {
    const map = { ...(values["linear.indicators"] as IndicatorMap) };
    if (!("getApproved" in map)) {
      map.getApproved = { filter: [{ type: "label", value: "approved" }] };
      map.clearApproved = { type: "label", value: "approved" };
      values["linear.indicators"] = map;
    }
  }
  // Park-status pollability: the awaiting-confirmation park marker is now set in
  // the Linear lifecycle indicators (`setAwaitingConfirmation`), not as a
  // separate question. When the gate is on and that marker is a status, the
  // parked ticket's worker is killed and re-discovered only through the
  // in-progress poll — so the park status MUST also be a `getInProgress` pickup
  // filter or the `approved` label is never seen. Wire it in automatically. Only
  // augments an indicators map already being written.
  if (
    values["linear.confirmationMode.enabled"] === true &&
    values["linear.indicators"] &&
    typeof values["linear.indicators"] === "object"
  ) {
    const map: IndicatorMap = { ...(values["linear.indicators"] as IndicatorMap) };
    const awaiting = map.setAwaitingConfirmation;
    const parkMarker = Array.isArray(awaiting)
      ? awaiting.find((marker) => marker.type === "status")
      : awaiting;
    if (
      parkMarker &&
      !Array.isArray(parkMarker) &&
      "type" in parkMarker &&
      parkMarker.type === "status"
    ) {
      const existing = map.getInProgress;
      const filter: IndicatorMarker[] =
        existing && !Array.isArray(existing) && "filter" in existing ? [...existing.filter] : [];
      if (!filter.some((marker) => marker.type === "status" && marker.value === parkMarker.value)) {
        filter.push({ type: "status", value: parkMarker.value });
        map.getInProgress = { filter };
        values["linear.indicators"] = map;
      }
    }
  }
  // `repo.link` is a control answer, not a frontmatter key. When confirmed, the
  // injected `repo.*` identity is written; when declined (or never shown), the
  // identity is dropped so no `repo` block is emitted. Either way the control
  // answer itself is removed so it never lands in the file.
  const linkRepo = values[REPO_LINK_FIELD_ID] === true;
  delete values[REPO_LINK_FIELD_ID];
  if (!linkRepo) {
    for (const id of REPO_ANSWER_IDS) delete values[id];
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
  /** Detected git repo, surfaced above the `repo.link` step. */
  detectedRepo?: { owner: string; name: string };
  /**
   * Called whenever the user advances or navigates between questions, with the
   * committed answers so far — used to back the in-progress session up to disk
   * so an accidental exit can be resumed.
   */
  onAnswersChange?: (state: { mode: SetupMode; values: Answers }) => void;
}

export function SetupWizard({
  onComplete,
  onCancel,
  initialMode,
  initialValues,
  buildMarkdown,
  onlyFields,
  initialBody,
  detectedRepo,
  onAnswersChange,
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
  /** Cursor offset into `draft` for the multiline (prompt-body) editor. */
  const [cursor, setCursor] = useState(startEditing?.draft.length ?? 0);
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
    setCursor(editing.draft.length);
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
    onAnswersChange?.({ mode: mode!, values: source });
  };

  // In diff mode we prefill every config value so gating works, but only the
  // diff fields should be written back — otherwise a sparse legacy file gains a
  // cluster of materialized defaults it never asked for.
  const valuesToWrite = (source: Answers): Answers => {
    if (!onlyFields) return source;
    const allowed = new Set(onlyFields);
    // The `repo.*` identity is injected, not walked through. When the diff
    // includes the `repo.link` control field, keep the identity ids so the
    // builder can write (or drop) the block based on the confirmation.
    if (allowed.has(REPO_LINK_FIELD_ID)) for (const id of REPO_ANSWER_IDS) allowed.add(id);
    return Object.fromEntries(Object.entries(source).filter(([id]) => allowed.has(id)));
  };

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

  // A migration whose diff is config-file-only (e.g. v5's `specAttachmentRevisions`)
  // produces zero wizard fields. There is nothing to walk through, so finalize
  // immediately — write the upgraded file (version stamp + default backfill on
  // write) rather than rendering a dead empty screen that crashes on keypress.
  useEffect(() => {
    if (mode !== null && !building && fields.length === 0) {
      onComplete(buildFromAnswers(mode, valuesToWrite(answers), buildMarkdown));
      exit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, building, fields.length]);

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
          onAnswersChange?.({ mode: chosen, values: answers });
        }
        return;
      }

      const current = fields[index]!;

      // Multiline (prompt body) captures all keys: arrows move the cursor,
      // type/backspace edit at the cursor, Enter inserts a newline, Ctrl-D
      // finishes. Esc (handled above) cancels the wizard.
      if (current.spec.kind === "multiline") {
        const at = Math.min(cursor, draft.length);
        const replaceAt = (next: string, nextCursor: number): void => {
          setDraft(next);
          setCursor(Math.max(0, Math.min(nextCursor, next.length)));
        };
        if (key.ctrl && input === "d") {
          advance(commitCurrent());
        } else if (key.leftArrow) {
          setCursor(Math.max(0, at - 1));
        } else if (key.rightArrow) {
          setCursor(Math.min(draft.length, at + 1));
        } else if (key.upArrow) {
          setCursor(moveCursorVertically(draft, at, -1));
        } else if (key.downArrow) {
          setCursor(moveCursorVertically(draft, at, 1));
        } else if (key.return) {
          replaceAt(`${draft.slice(0, at)}\n${draft.slice(at)}`, at + 1);
        } else if (key.backspace || key.delete) {
          if (at > 0) replaceAt(draft.slice(0, at - 1) + draft.slice(at), at - 1);
        } else if (input && !key.ctrl && !key.meta && !key.tab) {
          replaceAt(draft.slice(0, at) + input + draft.slice(at), at + input.length);
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
          <Text dimColor>
            {"  ·  "}v{VERSION}
          </Text>
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
        states={activeStates(answers)}
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
          {"  ·  "}v{VERSION}
          {"  ·  "}
          {mode} · step {index + 1}/{fields.length}
        </Text>
      </Text>

      {/* What's been answered so far */}
      <AnsweredHistory fields={fields} answers={answers} upTo={index} />

      {/* Current question: title → description → space → input */}
      <Box marginTop={1} flexDirection="column">
        {field.id === REPO_LINK_FIELD_ID && detectedRepo ? (
          <Text>
            <Text dimColor>Detected repo: </Text>
            <Text color="cyan">
              {detectedRepo.owner}/{detectedRepo.name}
            </Text>
          </Text>
        ) : null}
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
            cursor={cursor}
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
    return `↑↓ to move · space to select · enter to confirm · ${nav}`;
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

/** The {line, col} of a character offset within multi-line text. */
function cursorLineCol(text: string, offset: number): { line: number; col: number } {
  const lines = text.split("\n");
  let remaining = offset;
  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line]!.length) return { line, col: remaining };
    remaining -= lines[line]!.length + 1;
  }
  const last = lines.length - 1;
  return { line: last, col: lines[last]!.length };
}

/** Move a cursor offset up (-1) or down (+1) one line, keeping the column. */
function moveCursorVertically(text: string, offset: number, direction: -1 | 1): number {
  const lines = text.split("\n");
  const { line, col } = cursorLineCol(text, offset);
  const target = line + direction;
  if (target < 0 || target >= lines.length) return offset;
  let result = 0;
  for (let i = 0; i < target; i++) result += lines[i]!.length + 1;
  return result + Math.min(col, lines[target]!.length);
}

/** Renders only the interactive part of a question (options or text input). */
function QuestionInput({
  field,
  draft,
  cursor,
  optionIndex,
  listItems,
  selected,
}: {
  field: Field;
  draft: string;
  cursor: number;
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
    const pos = cursorLineCol(draft, cursor);
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {lines.map((line, i) => {
          if (i !== pos.line) {
            return <Text key={i}>{line === "" ? " " : line}</Text>;
          }
          // Draw the cursor as an inverse block over the char at the column
          // (or a trailing space when the cursor sits at end of line).
          return (
            <Text key={i}>
              {line.slice(0, pos.col)}
              <Text inverse>{line.slice(pos.col, pos.col + 1) || " "}</Text>
              {line.slice(pos.col + 1)}
            </Text>
          );
        })}
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

const RESUME_FRESH_OPTIONS: { label: string; value: "resume" | "fresh" }[] = [
  { label: "Resume where I left off", value: "resume" },
  { label: "Start fresh (discard the saved answers)", value: "fresh" },
];

/**
 * Shown by `ralphy init` when a backed-up, unfinished setup session is found
 * (`~/.ralph/setup.tmp`). Esc resolves to the LAST option ("fresh"), so an
 * accidental escape starts clean rather than silently reusing stale answers.
 */
export function ResumeOrFreshPrompt({
  onChoice,
}: {
  onChoice: (choice: "resume" | "fresh") => void;
}) {
  return (
    <ChoicePrompt
      title="Unfinished setup found"
      subtitle="A previous setup session was interrupted — resume it or start over"
      options={RESUME_FRESH_OPTIONS}
      onChoice={onChoice}
    />
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

type SlotCategory = "get" | "set" | "clear";
function categoryOf(slot: string): SlotCategory {
  if (slot.startsWith("get")) return "get";
  if (slot.startsWith("clear")) return "clear";
  return "set";
}

/**
 * A lifecycle state the builder asks about ONCE. The chosen marker is written
 * to every slot the state owns — so the same value drives the get / set / clear
 * for that state instead of being re-entered per slot.
 */
interface IndicatorState {
  key: string;
  label: string;
  description: string;
  /** get/set/clear slot ids that share this state's single value. */
  slots: string[];
}

export const CORE_STATES: IndicatorState[] = [
  {
    key: "todo",
    label: "Todo (pickup)",
    description: "Which Linear issues Ralphy picks up to work on.",
    slots: ["getTodo"],
  },
  {
    key: "inProgress",
    label: "In progress",
    description: "Set when Ralphy starts an issue; also used to find and resume in-flight work.",
    slots: ["getInProgress", "setInProgress"],
  },
  {
    key: "done",
    label: "Done / in review",
    description: "Set when the task finishes and its pull request is opened.",
    slots: ["setDone"],
  },
  {
    key: "prReady",
    label: "PR ready",
    description:
      "Optional, additive: set when the PR is marked ready for human review (non-draft), layered on top of Done. Skipped only on the immediate non-draft auto-merge path.",
    slots: ["setPrReady"],
  },
  {
    key: "error",
    label: "Error",
    description: "Applied when a task is quarantined after repeated failures.",
    slots: ["setError"],
  },
  {
    key: "autoMerge",
    label: "Auto-merge",
    description: "Opt-in: only auto-merge issues whose PR matches this.",
    slots: ["getAutoMerge"],
  },
];

export const CONFIRMATION_STATES: IndicatorState[] = [
  {
    key: "autoApprove",
    label: "Auto-approve",
    description: "Bypass the approval gate for issues that match this.",
    slots: ["getAutoApprove"],
  },
  {
    key: "approved",
    label: "Approved",
    description: "The marker a human adds to approve a plan; Ralphy detects it, then clears it.",
    slots: ["getApproved", "clearApproved"],
  },
  {
    key: "awaitingConfirmation",
    label: "Awaiting confirmation",
    description:
      "Optional: shown while an issue is parked for approval — set on entry, cleared on release.",
    slots: ["setAwaitingConfirmation", "clearAwaitingConfirmation"],
  },
];

/** Which states the builder walks — core lifecycle plus gate states when enabled. */
function activeStates(answers: Answers): IndicatorState[] {
  return answers["linear.confirmationMode.enabled"] === true
    ? [...CORE_STATES, ...CONFIRMATION_STATES]
    : CORE_STATES;
}

const ALL_TYPES = ["status", "label", "project", "attachment", "comment"] as const;
function typesForCategory(category: SlotCategory): string[] {
  if (category === "get") return [...ALL_TYPES];
  if (category === "set") return ALL_TYPES.filter((t) => t !== "comment");
  return ["label", "comment"]; // clear
}

/** Marker types valid for ALL of a state's slots (the intersection). */
function typeOptionsForState(state: IndicatorState): Option[] {
  let allowed: string[] = [...ALL_TYPES];
  for (const slot of state.slots) {
    const ok = new Set(typesForCategory(categoryOf(slot)));
    allowed = allowed.filter((t) => ok.has(t));
  }
  return allowed.map((t) => ({ label: t, value: t }));
}

/** Write `marker` to every slot in `state` (get→filter, set/clear→marker). */
function applyStateMarker(map: IndicatorMap, state: IndicatorState, marker: IndicatorMarker): void {
  for (const slot of state.slots) {
    map[slot] = categoryOf(slot) === "get" ? { filter: [marker] } : marker;
  }
}

export function IndicatorBuilder({
  states,
  onDone,
  onCancel,
}: {
  states: IndicatorState[];
  onDone: (map: IndicatorMap) => void;
  onCancel: () => void;
}) {
  const [stateIndex, setStateIndex] = useState(0);
  const [phase, setPhase] = useState<"type" | "value" | "group">("type");
  const [typeIndex, setTypeIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [pendingType, setPendingType] = useState("");
  const [pendingValue, setPendingValue] = useState("");
  const [map, setMap] = useState<IndicatorMap>({});

  const state = states[stateIndex];
  const typeChoices: Option[] = state
    ? [...typeOptionsForState(state), { label: "○ skip this state", value: "__skip" }]
    : [];

  const reset = (): void => {
    setPhase("type");
    setTypeIndex(0);
    setDraft("");
  };

  const nextState = (updated: IndicatorMap): void => {
    if (stateIndex >= states.length - 1) {
      onDone(updated);
      return;
    }
    setStateIndex(stateIndex + 1);
    reset();
  };

  const commitMarker = (marker: IndicatorMarker): void => {
    const updated: IndicatorMap = { ...map };
    applyStateMarker(updated, state!, marker);
    setMap(updated);
    nextState(updated);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (!state) return;

    if (phase === "type") {
      if (key.upArrow) setTypeIndex((typeIndex + typeChoices.length - 1) % typeChoices.length);
      else if (key.downArrow) setTypeIndex((typeIndex + 1) % typeChoices.length);
      else if (key.return) {
        const choice = typeChoices[typeIndex]!.value;
        if (choice === "__skip") nextState(map);
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
          commitMarker({ type: pendingType as IndicatorMarker["type"], value: text });
        }
      } else {
        commitMarker(
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

  if (!state) return null;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">◆ </Text>
        <Text bold>Linear indicators</Text>
        <Text dimColor>
          {"  ·  step "}
          {stateIndex + 1}/{states.length}
        </Text>
      </Text>
      <Text>
        {"  Configuring: "}
        <Text bold color="cyan">
          {state.label}
        </Text>
      </Text>
      <Text dimColor>
        {"  "}
        {state.description}
      </Text>
      <Text dimColor>
        {"  Sets: "}
        {state.slots.join(", ")}
      </Text>
      <Box marginTop={1} marginLeft={2} flexDirection="column">
        {phase === "type" ? (
          <>
            <Text>
              Choose a marker type for <Text bold>{state.label}</Text> (or skip):
            </Text>
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
              type a value · enter to confirm{phase === "group" ? " (blank = no group)" : ""} · esc
              cancel
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}
