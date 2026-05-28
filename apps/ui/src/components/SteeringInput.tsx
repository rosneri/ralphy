import { useState, useCallback } from "react";

interface SteeringInputProps {
  onSend: (message: string) => Promise<void>;
  disabled: boolean;
  onFocusChange?: (focused: boolean) => void;
}

export function SteeringInput({ onSend, disabled, onFocusChange }: SteeringInputProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = useCallback(async () => {
    const msg = value.trim();
    if (!msg || sending) return;
    setSending(true);
    await onSend(msg);
    setValue("");
    setSending(false);
  }, [value, sending, onSend]);

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "8px 12px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={
          disabled
            ? "Start the task to send steering..."
            : "Steer the agent (appends to STEERING.md)..."
        }
        disabled={disabled || sending}
        style={{
          flex: 1,
          padding: "6px 10px",
          fontSize: 12,
        }}
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || sending || !value.trim()}
        style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}
      >
        {sending ? "..." : "Send"}
      </button>
    </div>
  );
}
