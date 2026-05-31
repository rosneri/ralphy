import type { InspectionEvent } from "xstate";

const DEFAULT_PORT = 7357;

let sharedSocket: WebSocket | undefined;

function getOrOpenSocket(port: number): WebSocket {
  if (sharedSocket && sharedSocket.readyState !== WebSocket.CLOSED) {
    return sharedSocket;
  }
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.addEventListener("error", () => {
    // silently drop connection errors — inspection is optional
  });
  ws.addEventListener("close", () => {
    if (sharedSocket === ws) sharedSocket = undefined;
  });
  sharedSocket = ws;
  return ws;
}

export function createMachineInspector(
  port?: number,
): ((event: InspectionEvent) => void) | undefined {
  if (!process.env.XSTATE_INSPECT) return undefined;

  const resolvedPort =
    port ??
    (process.env.XSTATE_MCP_WS_PORT ? Number(process.env.XSTATE_MCP_WS_PORT) : DEFAULT_PORT);

  const socket = getOrOpenSocket(resolvedPort);

  return (event: InspectionEvent) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // silently drop send errors
    }
  };
}
