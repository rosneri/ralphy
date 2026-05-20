import { describe, expect, test } from "bun:test";
import { gateActive } from "../detections/gate";

describe("gateActive", () => {
  test("disabled config → false", () => {
    expect(
      gateActive({
        config: { confirmationMode: { enabled: false } },
        ticket: { labels: [] },
        persistedConfirmation: { confirmedAt: null },
      }),
    ).toBe(false);
  });

  test("opt-out label present → false", () => {
    expect(
      gateActive({
        config: { confirmationMode: { enabled: true, optOutLabel: "ralph:auto-approve" } },
        ticket: { labels: ["ralph:auto-approve"] },
        persistedConfirmation: { confirmedAt: null },
      }),
    ).toBe(false);
  });

  test("persisted confirmedAt non-null → false even with label gone", () => {
    expect(
      gateActive({
        config: { confirmationMode: { enabled: true, optOutLabel: "ralph:auto-approve" } },
        ticket: { labels: [] },
        persistedConfirmation: { confirmedAt: "2026-01-01T00:00:00Z" },
      }),
    ).toBe(false);
  });

  test("enabled + no opt-out + no persisted approval → true", () => {
    expect(
      gateActive({
        config: { confirmationMode: { enabled: true, optOutLabel: "ralph:auto-approve" } },
        ticket: { labels: ["some-other-label"] },
        persistedConfirmation: { confirmedAt: null },
      }),
    ).toBe(true);
  });
});
