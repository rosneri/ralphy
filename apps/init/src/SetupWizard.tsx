import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { VERSION } from "@ralphy/version";
import type { SetupMode, WizardAnswers, WizardValue } from "@ralphy/workflow/wizard-types";
import { fieldsForMode, type Field } from "@ralphy/workflow/fields";
import { REPO_LINK_FIELD_ID } from "@ralphy/workflow/fields/field-identifiers";
import {
  INDICATOR_OPTIONS,
  MODE_OPTIONS,
  optionsFor,
  REPO_ANSWER_IDS,
  type Answers,
} from "./setup-wizard/options";
import { buildFromAnswers } from "./setup-wizard/answers";
import { computeEditing, moveCursorVertically } from "./setup-wizard/editing";
import { OptionList } from "./setup-wizard/option-list";
import { AnsweredHistory, hintFor, QuestionInput } from "./setup-wizard/question-view";
import { activeStates, IndicatorBuilder } from "./setup-wizard/indicator-builder";

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
