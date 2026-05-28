import { describe, expect, test } from "bun:test";
import { gateActive } from "../detections/gate";

describe("gateActive", () => {
  test("disabled config → false", () => {
    expect(
      gateActive({
        config: { confirmationMode: { enabled: false } },
        persistedConfirmation: { confirmedAt: null },
      }),
    ).toBe(false);
  });

  test("persisted confirmedAt non-null → false", () => {
    expect(
      gateActive({
        config: { confirmationMode: { enabled: true } },
        persistedConfirmation: { confirmedAt: "2026-01-01T00:00:00Z" },
      }),
    ).toBe(false);
  });

  test("enabled + no persisted approval → true", () => {
    expect(
      gateActive({
        config: { confirmationMode: { enabled: true } },
        persistedConfirmation: { confirmedAt: null },
      }),
    ).toBe(true);
  });
});
