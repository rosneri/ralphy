import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ActorRefLike, InspectedEventEvent } from "xstate";
import { createMachineInspector } from "../machines/inspector";
import { pollOnce } from "../poll";
import { route } from "../router";
import type { FlowAssignment, RouterSignals } from "../types";

const baseline: RouterSignals = {
  bucket: "todo",
  prStatus: "none",
  awaiting: "none",
  mention: "none",
  stuck: false,
  boost: "p2",
  awaitingCi: "none",
};

const sig = (over: Partial<RouterSignals>): RouterSignals => ({ ...baseline, ...over });

async function pollAndCapture(
  signals: RouterSignals,
): Promise<{ signals: RouterSignals; assignment: FlowAssignment }[]> {
  const captured: { signals: RouterSignals; assignment: FlowAssignment }[] = [];
  await pollOnce<string, void>({
    gather: async () => ["issue-1"],
    classify: () => [signals],
    execute: async (rows) => {
      captured.push(...rows);
    },
  });
  return captured;
}

describe("happy-path: todo → implement", () => {
  const signals = sig({});

  it("route(signals) → implement", () => {
    expect(route(signals).flowId).toBe("implement");
  });

  it("pollOnce pipeline routes to implement", async () => {
    const rows = await pollAndCapture(signals);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignment.flowId).toBe("implement");
  });
});

describe("ci-fail → ci-fix", () => {
  const signals = sig({ prStatus: "ci-failing" });

  it("route(signals) → ci-fix", () => {
    expect(route(signals).flowId).toBe("ci-fix");
  });

  it("pollOnce pipeline routes to ci-fix", async () => {
    const rows = await pollAndCapture(signals);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignment.flowId).toBe("ci-fix");
  });
});

describe("conflict-fix", () => {
  const signals = sig({ prStatus: "conflicting" });

  it("route(signals) → conflict-fix", () => {
    expect(route(signals).flowId).toBe("conflict-fix");
  });

  it("pollOnce pipeline routes to conflict-fix", async () => {
    const rows = await pollAndCapture(signals);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignment.flowId).toBe("conflict-fix");
  });
});

describe("review-followup", () => {
  const signals = sig({ bucket: "review" });

  it("route(signals) → review-followup", () => {
    expect(route(signals).flowId).toBe("review-followup");
  });

  it("pollOnce pipeline routes to review-followup", async () => {
    const rows = await pollAndCapture(signals);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignment.flowId).toBe("review-followup");
  });
});

describe("confirmation gate", () => {
  const signals = sig({ awaiting: "awaiting" });

  it("route(signals) → confirmation", () => {
    expect(route(signals).flowId).toBe("confirmation");
  });

  it("pollOnce pipeline routes to confirmation", async () => {
    const rows = await pollAndCapture(signals);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignment.flowId).toBe("confirmation");
  });
});

describe("stuck", () => {
  const signals = sig({ stuck: true });

  it("route(signals) → stuck", () => {
    expect(route(signals).flowId).toBe("stuck");
  });

  it("pollOnce pipeline routes to stuck", async () => {
    const rows = await pollAndCapture(signals);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignment.flowId).toBe("stuck");
  });
});

describe("multi-issue ordering", () => {
  it("each of four issues routes to the correct flowId", async () => {
    const fourSignals = [
      sig({ awaiting: "awaiting" }), // → confirmation
      sig({ prStatus: "conflicting" }), // → conflict-fix
      sig({ prStatus: "ci-failing" }), // → ci-fix
      sig({}), // → implement
    ];
    const captured: { signals: RouterSignals; assignment: FlowAssignment }[] = [];
    await pollOnce<string, void>({
      gather: async () => ["a", "b", "c", "d"],
      classify: () => fourSignals,
      execute: async (rows) => {
        captured.push(...rows);
      },
    });
    expect(captured).toHaveLength(4);
    expect(captured[0]!.assignment.flowId).toBe("confirmation");
    expect(captured[1]!.assignment.flowId).toBe("conflict-fix");
    expect(captured[2]!.assignment.flowId).toBe("ci-fix");
    expect(captured[3]!.assignment.flowId).toBe("implement");
  });
});

describe("edge cases", () => {
  it("empty gather() → execute([]) no-crash", async () => {
    const captured: { signals: RouterSignals; assignment: FlowAssignment }[] = [];
    await expect(
      pollOnce<string, void>({
        gather: async () => [],
        classify: () => [],
        execute: async (rows) => {
          captured.push(...rows);
        },
      }),
    ).resolves.toBeUndefined();
    expect(captured).toHaveLength(0);
  });

  it("awaiting=revise beats prStatus=conflicting", () => {
    const signals = sig({ awaiting: "revise", prStatus: "conflicting" });
    expect(route(signals).flowId).toBe("confirmation");
  });

  it("prStatus=ci-failing + awaitingCi=watching → ci-fix wins", () => {
    const signals = sig({ prStatus: "ci-failing", awaitingCi: "watching" });
    expect(route(signals).flowId).toBe("ci-fix");
  });
});

// --- WebSocket mock helpers (same pattern as inspector.test.ts) ---

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

describe("inspector event sequence", () => {
  let originalWebSocket: typeof WebSocket;
  let currentWs: WsMock | undefined;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    currentWs = undefined;
  });

  afterEach(() => {
    if (currentWs) triggerRegisteredHandler(currentWs, "close");
    globalThis.WebSocket = originalWebSocket;
    delete process.env.XSTATE_INSPECT;
    delete process.env.XSTATE_MCP_WS_PORT;
  });

  it("sends @xstate.event JSON over an open socket", () => {
    process.env.XSTATE_INSPECT = "true";
    ({ ws: currentWs } = installMockWebSocket(1 /* OPEN */));
    const inspector = createMachineInspector(7357)!;
    inspector(FAKE_EVENT);
    expect(currentWs.send).toHaveBeenCalledTimes(1);
    const sent = (currentWs.send.mock.calls[0] as [string])[0];
    expect(JSON.parse(sent)).toMatchObject({ type: "@xstate.event" });
  });
});
