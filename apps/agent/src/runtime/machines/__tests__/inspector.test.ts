import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ActorRefLike, InspectedEventEvent } from "xstate";
// Static import is required for Bun to instrument this module for coverage.
// Dynamic freshModule() imports bypass instrumentation.
import { createMachineInspector } from "../inspector";

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

type WsMock = {
  readyState: number;
  send: ReturnType<typeof mock<(_data: string) => void>>;
  addEventListener: ReturnType<typeof mock<(_type: string, _handler: unknown) => void>>;
};

type CtorMock = ReturnType<typeof mock<() => WsMock>>;

function installMockWebSocket(readyState: number): { ws: WsMock; ctor: CtorMock } {
  const ws: WsMock = {
    readyState,
    send: mock((_data: string) => {}),
    addEventListener: mock((_type: string, _handler: unknown) => {}),
  };
  const ctor: CtorMock = mock(() => ws);
  Object.assign(ctor, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  (globalThis as { WebSocket: unknown }).WebSocket = ctor;
  return { ws, ctor };
}

function triggerRegisteredHandler(ws: WsMock, type: string): void {
  const call = ws.addEventListener.mock.calls.find((c) => c[0] === type);
  if (call) (call[1] as () => void)();
}

describe("createMachineInspector", () => {
  let originalWebSocket: typeof WebSocket;
  let currentWs: WsMock | undefined;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    currentWs = undefined;
  });

  afterEach(() => {
    // Fire the close event on the current socket to reset module-level sharedSocket.
    if (currentWs) triggerRegisteredHandler(currentWs, "close");
    globalThis.WebSocket = originalWebSocket;
    delete process.env.XSTATE_INSPECT;
    delete process.env.XSTATE_MCP_WS_PORT;
  });

  it("returns undefined when XSTATE_INSPECT is not set", () => {
    delete process.env.XSTATE_INSPECT;
    expect(createMachineInspector()).toBeUndefined();
  });

  it("returns a function when XSTATE_INSPECT is set", () => {
    process.env.XSTATE_INSPECT = "true";
    ({ ws: currentWs } = installMockWebSocket(0 /* CONNECTING */));
    expect(typeof createMachineInspector(7357)).toBe("function");
  });

  it("sends JSON over an open socket", () => {
    process.env.XSTATE_INSPECT = "true";
    ({ ws: currentWs } = installMockWebSocket(1 /* OPEN */));
    const inspector = createMachineInspector(7357)!;
    inspector(FAKE_EVENT);
    expect(currentWs.send).toHaveBeenCalledTimes(1);
    const sent = (currentWs.send.mock.calls[0] as [string])[0];
    expect(JSON.parse(sent)).toMatchObject({ type: "@xstate.event" });
  });

  it("silently drops events when socket is not open", () => {
    process.env.XSTATE_INSPECT = "true";
    ({ ws: currentWs } = installMockWebSocket(0 /* CONNECTING */));
    const inspector = createMachineInspector(7357)!;
    expect(() => inspector(FAKE_EVENT)).not.toThrow();
    expect(currentWs.send).not.toHaveBeenCalled();
  });

  it("reuses the existing open socket on a second call", () => {
    process.env.XSTATE_INSPECT = "true";
    const { ws, ctor } = installMockWebSocket(1 /* OPEN */);
    currentWs = ws;

    const inspector1 = createMachineInspector(7357)!;
    const inspector2 = createMachineInspector(7357)!;

    // Constructor called only once — second call reused sharedSocket
    expect(ctor.mock.calls).toHaveLength(1);

    inspector1(FAKE_EVENT);
    inspector2(FAKE_EVENT);
    expect(ws.send).toHaveBeenCalledTimes(2);
  });

  it("clears the shared socket when the close event fires", () => {
    process.env.XSTATE_INSPECT = "true";
    const { ws: ws1, ctor: ctor1 } = installMockWebSocket(1 /* OPEN */);
    currentWs = ws1;

    createMachineInspector(7357);
    expect(ctor1.mock.calls).toHaveLength(1);

    // Trigger close → sharedSocket = undefined
    triggerRegisteredHandler(ws1, "close");

    // Next call must open a new socket
    const { ws: ws2, ctor: ctor2 } = installMockWebSocket(1);
    currentWs = ws2;

    createMachineInspector(7357);
    expect(ctor2.mock.calls).toHaveLength(1);
  });
});
