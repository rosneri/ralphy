import { describe, expect, test } from "bun:test";
import { retroDepEntry } from "../spawn/worker";
import type { RetroDispositionInfo } from "../../post-task";

// The spawn wrapper must hand `runRetrospective` to `runPostTask` only under
// --agent-debug; otherwise the dep is omitted so normal runs pay nothing.

describe("retroDepEntry", () => {
  const hook = async (_info: RetroDispositionInfo): Promise<void> => {};

  test("wires the dep when agentDebug is true", () => {
    const entry = retroDepEntry(true, hook);
    expect(entry.runRetrospective).toBe(hook);
    expect("runRetrospective" in entry).toBe(true);
  });

  test("omits the dep entirely when agentDebug is false", () => {
    const entry = retroDepEntry(false, hook);
    expect("runRetrospective" in entry).toBe(false);
    expect(entry.runRetrospective).toBeUndefined();
  });
});
