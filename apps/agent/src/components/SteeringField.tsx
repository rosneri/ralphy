import { useEffect, useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";

export type SteeringStatus = "idle" | "sent" | "failed";

interface SteeringFieldProps {
  /** When false, the field is hidden and no keys are captured. */
  active: boolean;
  /** Total width of the labelled box (must match the parent card). */
  width: number;
  /** Called with the trimmed buffer when the user presses Enter on a non-empty message. */
  onSubmit: (message: string) => void | Promise<void>;
  /** Notifies the parent whenever the focus state changes (so it can gate worker shortcuts). */
  onFocusChange?: (focused: boolean) => void;
  /** Persisted initial buffer (used to survive parent remounts on resize). */
  initialBuffer?: string;
  /** Persisted initial cursor index (used to survive parent remounts on resize). */
  initialCursor?: number;
  /** Persisted initial focus flag (used to survive parent remounts on resize). */
  initialFocused?: boolean;
  /** Mirrors buffer/cursor/focus changes back to the parent for resize-survival. */
  onStateChange?: (state: { buffer: string; cursor: number; focused: boolean }) => void;
}

const STATUS_HINT_MS = 2000;
const PLACEHOLDER_IDLE = "CTRL+S to steer";
const PLACEHOLDER_SENT = "steered → next iteration";
const PLACEHOLDER_FAILED = "send failed";

interface FieldState {
  buffer: string;
  cursor: number;
  focused: boolean;
  status: SteeringStatus;
}

type FieldAction =
  | { type: "toggleFocus" }
  | { type: "clearAndBlur" }
  | { type: "insert"; chars: string }
  | { type: "backspace" }
  | { type: "moveLeft" }
  | { type: "moveRight" }
  | { type: "status"; value: SteeringStatus };

function reducer(state: FieldState, action: FieldAction): FieldState {
  switch (action.type) {
    case "toggleFocus":
      return { ...state, focused: !state.focused };
    case "clearAndBlur":
      return { ...state, buffer: "", cursor: 0, focused: false };
    case "insert": {
      const before = state.buffer.slice(0, state.cursor);
      const after = state.buffer.slice(state.cursor);
      return {
        ...state,
        buffer: before + action.chars + after,
        cursor: state.cursor + action.chars.length,
      };
    }
    case "backspace": {
      if (state.cursor === 0) return state;
      return {
        ...state,
        buffer: state.buffer.slice(0, state.cursor - 1) + state.buffer.slice(state.cursor),
        cursor: state.cursor - 1,
      };
    }
    case "moveLeft":
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case "moveRight":
      return { ...state, cursor: Math.min(state.buffer.length, state.cursor + 1) };
    case "status":
      return { ...state, status: action.value };
  }
}

/**
 * Single-line steering input rendered inside the focused worker card.
 * Self-contained: owns buffer/cursor/focus/status state and a transient
 * "just sent" / "send failed" hint. Submits via the injected onSubmit.
 */
export function SteeringField({
  active,
  width,
  onSubmit,
  onFocusChange,
  initialBuffer = "",
  initialCursor,
  initialFocused = false,
  onStateChange,
}: SteeringFieldProps) {
  const [state, dispatch] = useReducer(
    reducer,
    { initialBuffer, initialCursor, initialFocused },
    (init): FieldState => ({
      buffer: init.initialBuffer,
      cursor: init.initialCursor ?? init.initialBuffer.length,
      focused: init.initialFocused,
      status: "idle",
    }),
  );
  const { buffer, cursor, focused, status } = state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onFocusChange?.(focused);
  }, [focused, onFocusChange]);

  useEffect(() => {
    onStateChange?.({ buffer, cursor, focused });
  }, [buffer, cursor, focused, onStateChange]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  function flashStatus(next: "sent" | "failed") {
    dispatch({ type: "status", value: next });
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(
      () => dispatch({ type: "status", value: "idle" }),
      STATUS_HINT_MS,
    );
  }

  useInput(
    (input, key) => {
      if (key.ctrl && (input === "s" || input === "S")) {
        dispatch({ type: "toggleFocus" });
        return;
      }
      if (!stateRef.current.focused) return;

      if (key.escape) {
        dispatch({ type: "clearAndBlur" });
        return;
      }

      if (key.return) {
        const trimmed = stateRef.current.buffer.trim();
        if (trimmed.length === 0) return;
        void Promise.resolve()
          .then(() => onSubmit(trimmed))
          .then(() => {
            flashStatus("sent");
          })
          .catch(() => {
            flashStatus("failed");
          });
        dispatch({ type: "clearAndBlur" });
        return;
      }

      if (key.backspace || key.delete) {
        dispatch({ type: "backspace" });
        return;
      }

      if (key.leftArrow) {
        dispatch({ type: "moveLeft" });
        return;
      }
      if (key.rightArrow) {
        dispatch({ type: "moveRight" });
        return;
      }

      if (key.tab || key.upArrow || key.downArrow || key.ctrl || key.meta) return;

      if (!input) return;
      // eslint-disable-next-line no-control-regex
      const printable = input.replace(/[\x00-\x1f\x7f]/g, "");
      if (!printable) return;
      dispatch({ type: "insert", chars: printable });
    },
    { isActive: active },
  );

  if (!active) return null;

  const placeholder =
    status === "sent"
      ? PLACEHOLDER_SENT
      : status === "failed"
        ? PLACEHOLDER_FAILED
        : PLACEHOLDER_IDLE;
  const borderColor = focused ? "yellow" : "gray";
  const placeholderColor = status === "sent" ? "green" : status === "failed" ? "red" : "gray";

  const innerWidth = Math.max(0, width - 4);
  const labelText = " STEER (CTRL+S) ";
  const dashes = Math.max(0, innerWidth - labelText.length);
  const left = Math.floor(dashes / 2);
  const right = dashes - left;

  const before = buffer.slice(0, cursor);
  const at = buffer.slice(cursor, cursor + 1) || " ";
  const after = buffer.slice(cursor + 1);

  return (
    <Box flexDirection="column" width={width}>
      <Text color={borderColor}>{`╭${"─".repeat(left)}${labelText}${"─".repeat(right)}╮`}</Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderColor={borderColor}
        width={width}
        paddingX={1}
      >
        {focused ? (
          <Box>
            <Text color="white">{"> "}</Text>
            <Text>{before}</Text>
            <Text inverse>{at}</Text>
            <Text>{after}</Text>
          </Box>
        ) : (
          <Text color={placeholderColor} dimColor={status === "idle"}>
            {placeholder}
          </Text>
        )}
      </Box>
    </Box>
  );
}
