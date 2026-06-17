import { useState, useEffect, useRef, useCallback } from "react";
import { useSidecar } from "../context/Sidecar.context";
import type { FeedEvent, State } from "@ralphy/types";
import type { LoopRunnerEvent } from "@ralphy/core/loop-runner";

// The task WebSocket carries exactly the canonical `LoopRunnerEvent` union
// broadcast by the sidecar (see `apps/ui/src-sidecar/routes/loop.ts`), plus
// the `error` frame the route adds when the runner promise rejects. We decode
// against that contract directly rather than re-declaring a hand-rolled copy —
// the exhaustive switch below fails to compile if the union ever gains a kind.
type WsMessage = LoopRunnerEvent | { type: "error"; message: string };

export interface LogEntry {
  id: string;
  kind: "feed" | "info" | "steering";
  event?: FeedEvent;
  text?: string;
  timestamp: number;
}

export function useTaskStream(taskName: string | undefined) {
  const { baseUrl } = useSidecar();
  const [state, setState] = useState<State | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  // null = unknown (haven't heard from server yet), true/false = known
  const [isRunning, setIsRunning] = useState<boolean | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef(0);

  const connect = useCallback(() => {
    if (!taskName || !baseUrl) return;
    const wsUrl = baseUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/tasks/${taskName}/stream`);

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);
      const nextId = () => String(idRef.current++);
      const addInfo = (text: string) =>
        setLogEntries((prev) => [
          ...prev,
          { id: nextId(), kind: "info", text, timestamp: Date.now() },
        ]);

      switch (msg.type) {
        case "state":
          setState(msg.state);
          break;
        case "iteration-started":
          // No dedicated `running` frame exists — the first iteration event is
          // our confirmation that the loop is live.
          setIsRunning(true);
          addInfo(`Iteration ${msg.iteration} started (${msg.phase})`);
          break;
        case "iteration-finished":
          addInfo(`Iteration ${msg.iteration} ${msg.result}`);
          break;
        case "feed":
          setLogEntries((prev) => [
            ...prev,
            { id: nextId(), kind: "feed", event: msg.event, timestamp: Date.now() },
          ]);
          break;
        case "info":
          addInfo(msg.text);
          break;
        case "review-round":
          addInfo(
            `Review round ${msg.result.roundNumber}: ${msg.result.openFindings} open finding(s)` +
              (msg.result.capReached ? " (cap reached)" : ""),
          );
          break;
        case "steering-applied":
          setLogEntries((prev) => [
            ...prev,
            { id: nextId(), kind: "steering", text: msg.message, timestamp: Date.now() },
          ]);
          break;
        case "stopped":
          setStopReason(msg.reason);
          setIsRunning(false);
          break;
        case "error":
          addInfo(`Error: ${msg.message}`);
          break;
        default: {
          // Exhaustiveness guard: a new `LoopRunnerEvent` kind breaks the build here.
          const _exhaustive: never = msg;
          return _exhaustive;
        }
      }
    };

    ws.onclose = () => {
      setIsRunning(false);
    };

    wsRef.current = ws;
  }, [taskName, baseUrl]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  const startTask = useCallback(
    async (options: Record<string, unknown> = {}) => {
      if (!taskName) return;
      setIsRunning(true);
      setStopReason(null);
      setLogEntries([]);

      // Ensure WebSocket is connected before starting
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
        // Brief delay to let WS connect
        await new Promise((r) => setTimeout(r, 500));
      }

      await fetch(`${baseUrl}/tasks/${taskName}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });
    },
    [taskName, baseUrl, connect],
  );

  const stopTask = useCallback(async () => {
    if (!taskName) return;
    await fetch(`${baseUrl}/tasks/${taskName}/stop`, { method: "POST" });
  }, [taskName, baseUrl]);

  const addLogEntry = useCallback((kind: LogEntry["kind"], text: string) => {
    setLogEntries((prev) => [
      ...prev,
      { id: String(idRef.current++), kind, text, timestamp: Date.now() },
    ]);
  }, []);

  return {
    state,
    logEntries,
    isRunning,
    stopReason,
    startTask,
    stopTask,
    addLogEntry,
  };
}
