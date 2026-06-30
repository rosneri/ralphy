import { useState, type ReactNode } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { OptionList } from "./option-list";

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
