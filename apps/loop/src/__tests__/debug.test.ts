import { describe, expect, test } from "bun:test";
import { parseJsonlLog } from "../debug";

// `parseJsonlLog` reads the project-level `agent.log` (a JSONL stream of
// `RalphEvent` values) into the debug timeline. The `JsonlEntry` view it
// parses against is derived from the canonical `RalphEvent` union (RLF-254),
// so these assertions also pin the worker_pr wire shape: the PR url lives
// under `url`, with `prUrl` honoured only for pre-8a historical lines.

const TS = 1_700_000_000_000;

describe("parseJsonlLog — worker_pr rendering", () => {
  test("renders a worker_pr line carrying the canonical `url` field", () => {
    const line = JSON.stringify({
      type: "worker_pr",
      ts: TS,
      changeName: "my-change",
      url: "https://github.com/o/r/pull/7",
    });

    const [entry, ...rest] = parseJsonlLog(line);

    expect(rest).toHaveLength(0);
    expect(entry?.type).toBe("pr");
    expect(entry?.text).toBe("my-change: PR → https://github.com/o/r/pull/7");
  });

  test("falls back to the legacy `prUrl` field for historical lines", () => {
    const line = JSON.stringify({
      type: "worker_pr",
      ts: TS,
      changeName: "old-change",
      prUrl: "https://github.com/o/r/pull/3",
    });

    const [entry] = parseJsonlLog(line);

    expect(entry?.type).toBe("pr");
    expect(entry?.text).toBe("old-change: PR → https://github.com/o/r/pull/3");
  });

  test("filters worker_pr lines belonging to other changes", () => {
    const line = JSON.stringify({
      type: "worker_pr",
      ts: TS,
      changeName: "other-change",
      url: "https://github.com/o/r/pull/9",
    });

    expect(parseJsonlLog(line, "my-change")).toHaveLength(0);
  });
});
