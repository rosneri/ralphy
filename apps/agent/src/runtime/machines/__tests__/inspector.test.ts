import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ActorRefLike, InspectedEventEvent } from "xstate";

function freshModule() {
  return import("../inspector?t=" + Math.random());
}

const FAKE_ACTOR_REF: ActorRefLike = {
  sessionId: "fake-session",
  send: (_event: { type: string }) => {},
  getSnapshot: () => ({ status: "active" as const, output: undefined, error: undefined }),
};

const FAKE_EVENT: InspectedEventEvent = {
  type: "@xstate.event",
  actorRef: FAKE_ACTOR_REF,
  event: { type: "TEST" },
  sourceRef: undefined,
  rootId: "root",
};

function installMockWebSocket(readyState: number) {
  const ws = {
    readyState,
    send: mock((_data: string) => {}),
    addEventListener: mock((_type: string, _handler: unknown) => {}),
  };
  const ctor = mock(() => ws);
  // Static constants must be present so module code can reference WebSocket.OPEN etc.
  Object.assign(ctor, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  (globalThis as { WebSocket: unknown }).WebSocket = ctor;
  return ws;
}

describe("createMachineInspector", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    delete process.env.XSTATE_INSPECT;
    delete process.env.XSTATE_MCP_WS_PORT;
  });

  it("returns undefined when XSTATE_INSPECT is not set", async () => {
    delete process.env.XSTATE_INSPECT;
    const { createMachineInspector } = await freshModule();
    expect(createMachineInspector()).toBeUndefined();
  });

  it("returns a function when XSTATE_INSPECT is set", async () => {
    process.env.XSTATE_INSPECT = "true";
    installMockWebSocket(0 /* CONNECTING */);

    const { createMachineInspector } = await freshModule();
    const inspector = createMachineInspector(7357);
    expect(typeof inspector).toBe("function");
  });

  it("sends JSON over an open socket", async () => {
    process.env.XSTATE_INSPECT = "true";
    const ws = installMockWebSocket(1 /* OPEN */);

    const { createMachineInspector } = await freshModule();
    const inspector = createMachineInspector(7357)!;
    inspector(FAKE_EVENT);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = (ws.send.mock.calls[0] as [string])[0];
    expect(JSON.parse(sent)).toMatchObject({ type: "@xstate.event" });
  });

  it("silently drops events when socket is not open", async () => {
    process.env.XSTATE_INSPECT = "true";
    const ws = installMockWebSocket(0 /* CONNECTING */);

    const { createMachineInspector } = await freshModule();
    const inspector = createMachineInspector(7357)!;
    expect(() => inspector(FAKE_EVENT)).not.toThrow();
    expect(ws.send).not.toHaveBeenCalled();
  });
});
