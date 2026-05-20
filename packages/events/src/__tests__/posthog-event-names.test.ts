import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { POSTHOG_EVENT_ALLOWLIST } from "../consumers/posthog";

const GOLDEN = join(
  import.meta.dir,
  "../../../../apps/agent/src/__tests__/__golden__/posthog-new-ticket.jsonl",
);

describe("posthog allowlist", () => {
  test("every event name in the Stage 0 golden is in POSTHOG_EVENT_ALLOWLIST", async () => {
    const text = await Bun.file(GOLDEN).text();
    const names = new Set<string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed) as { event?: string };
      if (parsed.event) names.add(parsed.event);
    }
    const missing: string[] = [];
    for (const n of names) {
      if (!POSTHOG_EVENT_ALLOWLIST.has(n as never)) missing.push(n);
    }
    expect(missing).toEqual([]);
  });
});
