import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";
import type { Bus, EmitInput } from "@ralphy/events";
import { mentionFeature, emitMentionReviseComment, emitMentionSkipped } from "../index";
import type { FeatureCtx } from "../../types";

function recordingBus(events: EmitInput[]): Bus {
  return {
    emit: (e: EmitInput) => {
      events.push(e);
    },
    subscribe: () => () => {},
  } as unknown as Bus;
}

describe("mention feature", () => {
  test("descriptor: id, ownedSlot null (slice never owns a state slot)", () => {
    expect(mentionFeature.id).toBe("mention");
    expect(mentionFeature.ownedSlot).toBeNull();
  });

  test("detect returns null — slice never claims the per-poll walk", async () => {
    const ctx = {} as unknown as FeatureCtx;
    expect(await mentionFeature.detect(ctx)).toBeNull();
  });

  test("run is a no-op (resolves without touching ctx)", async () => {
    const ctx = {} as unknown as FeatureCtx;
    await expect(mentionFeature.run(ctx, { reason: "n/a" })).resolves.toBeUndefined();
  });

  test("emitMentionReviseComment emits feature.mention.reviseComment with payload", () => {
    const events: EmitInput[] = [];
    emitMentionReviseComment(recordingBus(events), {
      issueIdentifier: "RLF-99",
      source: "linear",
      at: "2026-05-15T10:00:00Z",
      body: "@ralphy please revise",
    });
    expect(events).toEqual([
      {
        type: "feature.mention.reviseComment",
        issueIdentifier: "RLF-99",
        source: "linear",
        at: "2026-05-15T10:00:00Z",
        body: "@ralphy please revise",
      } as unknown as EmitInput,
    ]);
  });

  test("emitMentionSkipped emits feature.mention.skipped with the reason", () => {
    const events: EmitInput[] = [];
    emitMentionSkipped(recordingBus(events), "preempted-by:confirmation");
    expect(events).toEqual([
      { type: "feature.mention.skipped", reason: "preempted-by:confirmation" } as EmitInput,
    ]);
  });

  test("slice never writes state.confirmation directly", async () => {
    // Boundary guarantee: the spec forbids this slice from touching the
    // confirmation slot. Scan every source file under `features/mention/`
    // for any literal that looks like a confirmation-slot write — i.e.
    // anything that lands `state.confirmation` as the prefix of a
    // `writeField` path. The test fails fast (with file:line context)
    // when a regression slips in, complementing the
    // `feature-boundaries.test.ts` import check.
    const MENTION_ROOT = resolve(import.meta.dir, "..");
    const offenders: { file: string; line: number; text: string }[] = [];
    const glob = new Glob("**/*.ts");
    for await (const rel of glob.scan({ cwd: MENTION_ROOT, absolute: false })) {
      if (rel.startsWith("__tests__/")) continue;
      const abs = resolve(MENTION_ROOT, rel);
      const source = await Bun.file(abs).text();
      const lines = source.split("\n");
      // Strip block comments and line comments so the scan only inspects
      // executable code — leading documentation that names the forbidden
      // slot to explain why it's off-limits is allowed.
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""));
      stripped.forEach((text, i) => {
        if (/["']confirmation(?:\.|["'])/.test(text) || /\bstate\.confirmation\b/.test(text)) {
          offenders.push({ file: rel, line: i + 1, text: lines[i]?.trim() ?? text.trim() });
        }
      });
    }
    if (offenders.length > 0) {
      const lines = offenders.map((o) => `  features/mention/${o.file}:${o.line} → ${o.text}`);
      throw new Error(
        `The mention slice must not reference state.confirmation directly. ` +
          `Emit feature.mention.reviseComment instead.\n${lines.join("\n")}`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
