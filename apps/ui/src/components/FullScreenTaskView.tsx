import { useState, useEffect, useRef, useCallback } from "react";
import { useSidecar } from "../context/Sidecar.context";
import { useTaskStream } from "../hooks/useTaskStream";
import { useDocument } from "../hooks/useDocument";
import { FeedLine } from "./FeedLine";
import { StatusBar } from "./StatusBar";
import { ProgressList } from "./ProgressList";
import { SteeringInput } from "./SteeringInput";
import { DocPanel, panelHeaderStyle } from "./DocPanel";
import type { State } from "@ralphy/types";

type TaskRef = { name: string };

export function getAdjacentTask(
  tasks: TaskRef[],
  current: string,
  direction: "prev" | "next",
): string | null {
  if (tasks.length === 0) return null;
  const idx = tasks.findIndex((t) => t.name === current);
  if (idx === -1) return null;
  if (direction === "prev") {
    return tasks[(idx - 1 + tasks.length) % tasks.length]!.name;
  }
  return tasks[(idx + 1) % tasks.length]!.name;
}

interface FullScreenTaskViewProps {
  taskName: string;
  tasks: TaskRef[];
  onClose: () => void;
}

export function FullScreenTaskView({ taskName, tasks, onClose }: FullScreenTaskViewProps) {
  const [currentName, setCurrentName] = useState(taskName);
  const { baseUrl } = useSidecar();

  const { state: streamState, logEntries, progress, progressItems, isRunning, stopReason, addLogEntry } =
    useTaskStream(currentName);

  const [initialState, setInitialState] = useState<State | null>(null);
  useEffect(() => {
    setInitialState(null);
    if (!currentName || !baseUrl) return;
    fetch(`${baseUrl}/tasks/${currentName}`)
      .then((r) => r.json())
      .then(setInitialState)
      .catch(() => {});
  }, [currentName, baseUrl]);

  const state = streamState ?? initialState;
  const effectiveIsRunning =
    isRunning !== null
      ? isRunning
      : (initialState as Record<string, unknown> | null)?.isRunning === true;

  const steering = useDocument(currentName, "STEERING.md");
  const plan = useDocument(currentName, "PLAN.md");
  const spec = useDocument(currentName, "spec.md");
  const research = useDocument(currentName, "RESEARCH.md");
  const log = useDocument(currentName, "LOG.jsonl");

  type DocKey = "spec" | "plan" | "research" | "progress" | "steering" | "log";
  const [expandedDoc, setExpandedDoc] = useState<DocKey>("spec");

  useEffect(() => {
    if (expandedDoc !== "log") return;
    log.refresh();
    if (!effectiveIsRunning) return;
    const interval = setInterval(() => log.refresh(), 3000);
    return () => clearInterval(interval);
  }, [expandedDoc, effectiveIsRunning, log.refresh]);

  const feedRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [logEntries, autoScroll]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const handleSendSteering = useCallback(
    async (message: string) => {
      if (!currentName || !baseUrl) return;
      await fetch(`${baseUrl}/tasks/${currentName}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      steering.refresh();
      addLogEntry("steering", message);
    },
    [currentName, baseUrl, steering, addLogEntry],
  );

  const [steeringFocused, setSteeringFocused] = useState(false);

  const navigatePrev = useCallback(() => {
    const prev = getAdjacentTask(tasks, currentName, "prev");
    if (prev) setCurrentName(prev);
  }, [tasks, currentName]);

  const navigateNext = useCallback(() => {
    const next = getAdjacentTask(tasks, currentName, "next");
    if (next) setCurrentName(next);
  }, [tasks, currentName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (steeringFocused) return;
      if (e.key === "ArrowLeft" || e.key === "[") {
        e.preventDefault();
        navigatePrev();
      } else if (e.key === "ArrowRight" || e.key === "]") {
        e.preventDefault();
        navigateNext();
      } else if (e.key === "Escape" || e.key === "f") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [steeringFocused, navigatePrev, navigateNext, onClose]);

  const currentIdx = tasks.findIndex((t) => t.name === currentName);
  const positionText = currentIdx >= 0 ? `${currentIdx + 1} / ${tasks.length}` : "";

  return (
    <div className="fullscreen-overlay">
      <div className="fullscreen-nav">
        <button onClick={navigatePrev} disabled={tasks.length <= 1} style={{ padding: "4px 8px" }}>
          ←
        </button>
        <button onClick={navigateNext} disabled={tasks.length <= 1} style={{ padding: "4px 8px" }}>
          →
        </button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{currentName}</span>
        {positionText && (
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{positionText}</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
          [ / ] navigate • Esc close
        </span>
        <button onClick={onClose} style={{ padding: "4px 8px" }}>
          ✕
        </button>
      </div>

      {state && (
        <StatusBar
          state={state}
          progress={progress}
          isRunning={effectiveIsRunning}
          stopReason={stopReason}
        />
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div
            ref={feedRef}
            onScroll={handleScroll}
            style={{
              flex: 1,
              overflow: "auto",
              padding: "12px 20px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            {logEntries.length === 0 && !effectiveIsRunning ? (
              <p style={{ color: "var(--text-dim)", textAlign: "center", paddingTop: 40 }}>
                {state?.status === "completed"
                  ? "Task completed."
                  : state?.iteration
                    ? `${state.iteration} iterations completed.`
                    : "No activity yet."}
              </p>
            ) : (
              logEntries.map((entry) => <FeedLine key={entry.id} entry={entry} />)
            )}

            {stopReason && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--warning)",
                }}
              >
                Loop stopped: {stopReason}
              </div>
            )}
          </div>

          <SteeringInput
            onSend={handleSendSteering}
            disabled={!effectiveIsRunning}
            onFocusChange={setSteeringFocused}
          />
        </div>

        <div
          style={{
            width: 360,
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <DocPanel
            title="SPEC"
            expanded={expandedDoc === "spec"}
            content={spec.content}
            loading={spec.loading}
            placeholder="Feature specification."
            onExpand={() => setExpandedDoc("spec")}
          />
          <DocPanel
            title="RESEARCH"
            expanded={expandedDoc === "research"}
            content={research.content}
            loading={research.loading}
            placeholder="Research notes."
            onExpand={() => setExpandedDoc("research")}
          />
          <DocPanel
            title="PLAN"
            expanded={expandedDoc === "plan"}
            content={plan.content}
            loading={plan.loading}
            placeholder="Implementation plan."
            onExpand={() => setExpandedDoc("plan")}
          />
          {expandedDoc === "progress" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={panelHeaderStyle}>PROGRESS</div>
              <ProgressList items={progressItems} />
            </div>
          ) : (
            <div
              onClick={() => setExpandedDoc("progress")}
              style={{
                padding: "8px 12px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg-surface)",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                color: "var(--text-dim)",
              }}
            >
              PROGRESS
            </div>
          )}
          <DocPanel
            title="STEERING"
            expanded={expandedDoc === "steering"}
            content={steering.content}
            loading={steering.loading}
            placeholder="Live guidance for the task."
            onExpand={() => setExpandedDoc("steering")}
          />
          <DocPanel
            title="LOG"
            expanded={expandedDoc === "log"}
            content={log.content}
            loading={log.loading}
            placeholder="Iteration log."
            onExpand={() => setExpandedDoc("log")}
          />
        </div>
      </div>
    </div>
  );
}
