import { afterEach, describe, expect, it, mock } from "bun:test";
import { createIssueFlowActor } from "../index";
import type { IssueFlowContext, IssueFlowEvent } from "../index";
import type { RouterSignals } from "../../types";

function makeSignals(overrides: Partial<RouterSignals> = {}): RouterSignals {
  return {
    bucket: "todo",
    prStatus: "none",
    awaiting: "none",
    mention: "none",
    stuck: false,
    boost: "p2",
    awaitingCi: "none",
    ...overrides,
  };
}

function startActor() {
  const actor = createIssueFlowActor("TEST-1");
  actor.start();
  return actor;
}

let originalWebSocket: typeof WebSocket | undefined;

afterEach(() => {
  if (originalWebSocket) {
    globalThis.WebSocket = originalWebSocket;
    originalWebSocket = undefined;
  }
  delete process.env.XSTATE_INSPECT;
});

describe("issueFlowMachine", () => {
  it("wires the optional inspector when enabled", () => {
    originalWebSocket = globalThis.WebSocket;
    process.env.XSTATE_INSPECT = "true";
    const addEventListener = mock((_type: string, _handler: unknown) => {});
    const ws = {
      readyState: 0,
      send: mock((_data: string) => {}),
      addEventListener,
    };
    const ctor = mock(() => ws);
    Object.assign(ctor, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    (globalThis as { WebSocket: unknown }).WebSocket = ctor;

    const actor = startActor();

    expect(ctor).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().context.issueId).toBe("TEST-1");
    const closeHandler = addEventListener.mock.calls.find((call) => call[0] === "close")?.[1];
    if (typeof closeHandler === "function") closeHandler();
  });

  describe("happy path — implement", () => {
    it("routes idle → implement → workerRunning → done", () => {
      const actor = startActor();
      expect(actor.getSnapshot().value).toBe("idle");

      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      expect(actor.getSnapshot().value).toBe("implement");

      actor.send({ type: "WORKER_STARTED" });
      expect(actor.getSnapshot().value).toBe("workerRunning");

      actor.send({ type: "WORKER_EXITED", exitCode: 0 });
      expect(actor.getSnapshot().value).toBe("done");
    });

    it("treats NO_CHANGES_EXIT (72) as success", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      actor.send({ type: "WORKER_STARTED" });
      actor.send({ type: "WORKER_EXITED", exitCode: 72 });
      expect(actor.getSnapshot().value).toBe("done");
    });

    it("routes to error on non-zero exit code", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      actor.send({ type: "WORKER_STARTED" });
      actor.send({ type: "WORKER_EXITED", exitCode: 1 });
      expect(actor.getSnapshot().value).toBe("error");
    });
  });

  describe("awaiting-ci path (no worker)", () => {
    it("routes idle → awaitingCi → done on AWAITING_CI_SETTLED(ok:true)", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ awaitingCi: "watching" }) });
      expect(actor.getSnapshot().value).toBe("awaitingCi");

      actor.send({ type: "AWAITING_CI_SETTLED", ok: true });
      expect(actor.getSnapshot().value).toBe("done");
    });

    it("routes back to detecting on AWAITING_CI_SETTLED(ok:false)", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ awaitingCi: "watching" }) });
      // AWAITING_CI_SETTLED(ok:false) → detecting → re-routes based on current signals
      actor.send({ type: "AWAITING_CI_SETTLED", ok: false });
      // signals still have awaitingCi:watching, so it re-routes to awaitingCi
      expect(actor.getSnapshot().value).toBe("awaitingCi");
    });

    it("does NOT transition on WORKER_STARTED", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ awaitingCi: "watching" }) });
      expect(actor.getSnapshot().value).toBe("awaitingCi");

      actor.send({ type: "WORKER_STARTED" });
      // Should stay in awaitingCi — no WORKER_STARTED transition defined
      expect(actor.getSnapshot().value).toBe("awaitingCi");
    });
  });

  describe("preemption path", () => {
    it("preempts workerRunning → detecting → reviewFollowup", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      actor.send({ type: "WORKER_STARTED" });
      expect(actor.getSnapshot().value).toBe("workerRunning");

      actor.send({ type: "PREEMPTED", signals: makeSignals({ bucket: "review" }) });
      expect(actor.getSnapshot().value).toBe("reviewFollowup");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("review-followup");
    });
  });

  describe("RESET", () => {
    it("resets from done to idle", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      actor.send({ type: "WORKER_STARTED" });
      actor.send({ type: "WORKER_EXITED", exitCode: 0 });
      expect(actor.getSnapshot().value).toBe("done");

      actor.send({ type: "RESET" });
      expect(actor.getSnapshot().value).toBe("idle");
    });

    it("resets from error to idle", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      actor.send({ type: "WORKER_STARTED" });
      actor.send({ type: "WORKER_EXITED", exitCode: 1 });
      expect(actor.getSnapshot().value).toBe("error");

      actor.send({ type: "RESET" });
      expect(actor.getSnapshot().value).toBe("idle");
    });
  });

  describe("ROUTER_TABLE guard coverage", () => {
    it("isRevise (awaiting=revise) → confirmation", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ awaiting: "revise" }) });
      expect(actor.getSnapshot().value).toBe("confirmation");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("confirmation");
    });

    it("isRevise (mention=revise) → confirmation", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ mention: "revise" }) });
      expect(actor.getSnapshot().value).toBe("confirmation");
    });

    it("isConfirm (awaiting=awaiting) → confirmation", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ awaiting: "awaiting" }) });
      expect(actor.getSnapshot().value).toBe("confirmation");
    });

    it("isConflicting (prStatus=conflicting) → conflictFix", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ prStatus: "conflicting" }) });
      expect(actor.getSnapshot().value).toBe("conflictFix");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("conflict-fix");
    });

    it("isConflicting (bucket=conflicted) → conflictFix", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "conflicted" }) });
      expect(actor.getSnapshot().value).toBe("conflictFix");
    });

    it("isCiFailing (prStatus=ci-failing) → ciFix", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ prStatus: "ci-failing" }) });
      expect(actor.getSnapshot().value).toBe("ciFix");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("ci-fix");
    });

    it("isAwaitingCiPass (awaitingCi=watching + prStatus=mergeable) → awaitingCi", () => {
      const actor = startActor();
      actor.send({
        type: "ROUTE",
        signals: makeSignals({ awaitingCi: "watching", prStatus: "mergeable" }),
      });
      expect(actor.getSnapshot().value).toBe("awaitingCi");
      expect(actor.getSnapshot().context.assignment?.reason).toBe("awaiting-ci pass");
    });

    it("isAwaitingCiWatch (awaitingCi=watching) → awaitingCi", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ awaitingCi: "watching" }) });
      expect(actor.getSnapshot().value).toBe("awaitingCi");
      expect(actor.getSnapshot().context.assignment?.reason).toBe("awaiting-ci watch");
    });

    it("isAwaitingCiPass takes precedence over isAwaitingCiWatch", () => {
      const actor = startActor();
      actor.send({
        type: "ROUTE",
        signals: makeSignals({ awaitingCi: "watching", prStatus: "mergeable" }),
      });
      // Should hit pass row first, not watch row
      expect(actor.getSnapshot().context.assignment?.reason).toBe("awaiting-ci pass");
    });

    it("isReviewBucket (bucket=review) → reviewFollowup", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "review" }) });
      expect(actor.getSnapshot().value).toBe("reviewFollowup");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("review-followup");
    });

    it("isStuck (stuck=true) → stuck", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ stuck: true }) });
      expect(actor.getSnapshot().value).toBe("stuck");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("stuck");
    });

    it("isNewTicket (bucket=todo + mention=new-ticket) → newTicket", () => {
      const actor = startActor();
      actor.send({
        type: "ROUTE",
        signals: makeSignals({ bucket: "todo", mention: "new-ticket" }),
      });
      expect(actor.getSnapshot().value).toBe("newTicket");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("new-ticket");
    });

    it("isMentionCatchAll (mention≠none and no other match) → mention", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ mention: "stuck" }) });
      expect(actor.getSnapshot().value).toBe("mention");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("mention");
    });

    it("isInProgressImplement (bucket=in-progress) → implement", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      expect(actor.getSnapshot().value).toBe("implement");
      expect(actor.getSnapshot().context.assignment?.flowId).toBe("implement");
      expect(actor.getSnapshot().context.assignment?.reason).toBe("in-progress implement");
    });

    it("isTodoImplement (bucket=todo, no mention) → implement", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "todo" }) });
      expect(actor.getSnapshot().value).toBe("implement");
      expect(actor.getSnapshot().context.assignment?.reason).toBe("todo implement");
    });

    it("idle catch-all (signals with no matches) → idle", () => {
      const actor = startActor();
      actor.send({
        type: "ROUTE",
        signals: makeSignals({
          bucket: "done",
          prStatus: "none",
          awaiting: "none",
          mention: "none",
        }),
      });
      expect(actor.getSnapshot().value).toBe("idle");
      expect(actor.getSnapshot().context.assignment).toBeNull();
    });
  });

  describe("context assignments", () => {
    it("stores signals in context on ROUTE", () => {
      const actor = startActor();
      const signals = makeSignals({ bucket: "in-progress" });
      const event: IssueFlowEvent = { type: "ROUTE", signals };
      actor.send(event);
      const ctx: IssueFlowContext = actor.getSnapshot().context;
      expect(ctx.signals).toEqual(signals);
    });

    it("stores workerExitCode on WORKER_EXITED", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      actor.send({ type: "WORKER_STARTED" });
      actor.send({ type: "WORKER_EXITED", exitCode: 5 });
      expect(actor.getSnapshot().context.workerExitCode).toBe(5);
    });

    it("updates signals on PREEMPTED", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      actor.send({ type: "WORKER_STARTED" });
      const newSignals = makeSignals({ bucket: "review" });
      actor.send({ type: "PREEMPTED", signals: newSignals });
      expect(actor.getSnapshot().context.signals).toEqual(newSignals);
    });

    it("null signals with no match falls back to idle with null assignment", () => {
      const actor = startActor();
      // Force signals to null by sending ROUTE then going through detecting
      // (can't truly get null after ROUTE — use done bucket which has no match)
      actor.send({
        type: "ROUTE",
        signals: makeSignals({
          bucket: "cancelled",
          prStatus: "none",
          mention: "none",
          awaiting: "none",
          stuck: false,
        }),
      });
      expect(actor.getSnapshot().value).toBe("idle");
      expect(actor.getSnapshot().context.assignment).toBeNull();
    });
  });

  describe("ROUTE re-routing from non-idle states", () => {
    it("re-routes from implement via ROUTE", () => {
      const actor = startActor();
      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "in-progress" }) });
      expect(actor.getSnapshot().value).toBe("implement");

      actor.send({ type: "ROUTE", signals: makeSignals({ bucket: "review" }) });
      expect(actor.getSnapshot().value).toBe("reviewFollowup");
    });
  });
});
