import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultConfirmation,
  readConfirmationState,
  writeConfirmationState,
  type ConfirmationState,
} from "../state";

describe("confirmation/state — smoke", () => {
  test("default → write → read roundtrip preserves every field", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-slice-"));
    try {
      const path = join(dir, "state.json");
      const seed: ConfirmationState = {
        ...defaultConfirmation(),
        askedAt: "2026-05-21T01:00:00.000Z",
        rounds: 1,
        lastReviseConsumedAt: "2026-05-21T02:00:00.000Z",
      };
      await writeConfirmationState(path, { iteration: 7 }, seed);
      const { stateObj, confirmation } = await readConfirmationState(path);
      expect(stateObj.iteration).toBe(7);
      expect(confirmation).toEqual(seed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing state file yields defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-slice-"));
    try {
      const { stateObj, confirmation } = await readConfirmationState(join(dir, "nope.json"));
      expect(stateObj).toEqual({});
      expect(confirmation).toEqual(defaultConfirmation());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
