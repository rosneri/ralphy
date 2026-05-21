import { describe, expect, it } from "bun:test";
import { pollOnce } from "../poll";
import type { FlowAssignment, RouterSignals } from "../types";

describe("runtime/poll", () => {
  it("invokes gather → classify → route → execute in order", async () => {
    const order: string[] = [];
    const signal: RouterSignals = {
      bucket: "todo",
      prStatus: "none",
      awaiting: "none",
      mention: "none",
      stuck: false,
      boost: "p2",
    };
    const assignment: FlowAssignment = {
      flowId: "implement",
      reason: "todo implement",
      boost: "p2",
    };

    await pollOnce<string, void>({
      gather: async () => {
        order.push("gather");
        return ["issue-1"];
      },
      classify: (issues) => {
        order.push("classify");
        expect(issues).toEqual(["issue-1"]);
        return [signal];
      },
      route: (s) => {
        order.push("route");
        expect(s).toBe(signal);
        return assignment;
      },
      execute: async (rows) => {
        order.push("execute");
        expect(rows).toEqual([{ signals: signal, assignment }]);
      },
    });

    expect(order).toEqual(["gather", "classify", "route", "execute"]);
  });
});
