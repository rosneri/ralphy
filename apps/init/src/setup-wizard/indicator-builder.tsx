import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { IndicatorMap, IndicatorMarker } from "@ralphy/workflow/wizard-types";
import type { Option, Answers } from "./options";
import { OptionList } from "./option-list";

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
export function activeStates(answers: Answers): IndicatorState[] {
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
