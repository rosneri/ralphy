import { useState, useEffect, useRef } from "react";
import type { State } from "@ralphy/types";
import type { ProgressCount } from "../hooks/useTaskStream";
import { formatCost } from "../utils/format-cost";

interface StatusBarProps {
  state: State;
  progress: ProgressCount | null;
  isRunning: boolean;
  stopReason: string | null;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function StatusBar({ state, progress, isRunning, stopReason }: StatusBarProps) {
  const pct =
    progress && progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : null;

  // Live elapsed time: track when running started and tick every second
  const [extraMs, setExtraMs] = useState(0);
  const runStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      runStartRef.current = Date.now();
      setExtraMs(0);
      const interval = setInterval(() => {
        setExtraMs(Date.now() - runStartRef.current!);
      }, 1000);
      return () => clearInterval(interval);
    }
    runStartRef.current = null;
    setExtraMs(0);
    return undefined;
  }, [isRunning]);

  const totalMs = state.usage.total_duration_ms + extraMs;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "8px 20px",
        borderBottom: "1px solid var(--border)",
        fontSize: 12,
        color: "var(--text-dim)",
        background: isRunning ? "var(--bg-surface)" : "transparent",
      }}
    >
      <span>
        <strong style={{ color: "var(--text)" }}>Status:</strong> {state.status}
      </span>

      <span>
        <strong style={{ color: "var(--text)" }}>Total:</strong> {state.iteration} iterations
      </span>

      {pct !== null && (
        <span>
          <strong style={{ color: "var(--text)" }}>Progress:</strong> {progress!.checked}/
          {progress!.total} ({pct}%)
        </span>
      )}

      <span>
        <strong style={{ color: "var(--text)" }}>Cost:</strong>{" "}
        {formatCost(state.usage.total_cost_usd)}
      </span>

      <span>
        <strong style={{ color: "var(--text)" }}>Time:</strong> {formatDuration(totalMs)}
      </span>

      <span>
        <strong style={{ color: "var(--text)" }}>Engine:</strong> {state.engine}/{state.model}
      </span>

      {isRunning && <span style={{ color: "var(--success)", fontWeight: 600 }}>● RUNNING</span>}

      {stopReason && <span style={{ color: "var(--warning)" }}>Stopped: {stopReason}</span>}
    </div>
  );
}
