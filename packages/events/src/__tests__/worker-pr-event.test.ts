import { describe, expect, test } from "bun:test";
import { createBus } from "../bus";
import type { RalphEvent } from "../types";

// The canonical wire shape for a "PR opened" notification. Extracting the
// variant pins the excess-property check to this single object type (the bus
// union still has other members with index signatures that would otherwise
// mask an unknown key).
type WorkerPrEvent = Extract<RalphEvent, { type: "worker_pr" }>;

describe("worker_pr event wire format", () => {
  test("carries the PR url under `url` and round-trips through the bus", () => {
    const bus = createBus();
    let last: WorkerPrEvent | undefined;
    bus.on("worker_pr", (e) => {
      last = e;
    });

    const ev: WorkerPrEvent = {
      type: "worker_pr",
      ts: 1,
      changeName: "my-change",
      url: "https://github.com/o/r/pull/7",
    };
    bus.emit(ev);

    expect(last?.type).toBe("worker_pr");
    expect(last?.url).toBe("https://github.com/o/r/pull/7");
  });

  test("rejects the legacy `prUrl` field as an excess property", () => {
    const ev: WorkerPrEvent = {
      type: "worker_pr",
      ts: 1,
      changeName: "my-change",
      url: "https://github.com/o/r/pull/7",
      // @ts-expect-error - `prUrl` is not a member of the worker_pr variant; the
      // canonical PR field is `url`. The masking `[k: string]: unknown` index
      // signature was removed so this excess property is now a compile error.
      prUrl: "https://github.com/o/r/pull/7",
    };

    expect(ev.type).toBe("worker_pr");
  });
});
