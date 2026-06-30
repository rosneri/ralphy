import { Box, Text } from "ink";
import type { Field, FieldSpec } from "@ralphy/workflow/fields";
import type { WizardValue } from "@ralphy/workflow/wizard-types";
import { optionsFor, type Answers } from "./options";
import { OptionList } from "./option-list";
import { cursorLineCol } from "./editing";

/** Human-readable rendering of an answer for the history list. */
export function formatAnswer(field: Field, value: WizardValue | undefined): string {
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

export function hintFor(kind: FieldSpec["kind"]): string {
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

/** Renders only the interactive part of a question (options or text input). */
export function QuestionInput({
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

export function AnsweredHistory({
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
