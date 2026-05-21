import { describe, expect, test } from "bun:test";
import { createBus } from "@ralphy/events";
import type { RalphEvent } from "@ralphy/events";
import { registry, selectRegistry } from "../registry";
import type { Capabilities } from "../types";

const FULL_CAPS: Capabilities = {
  gh: {},
  linear: {},
  git: {},
  fsChange: {},
  worker: {},
  confirmation: {
    detect: async () => false,
    run: async () => undefined,
  },
  conflictFix: {} as Capabilities["conflictFix"],
  ciFix: {} as Capabilities["ciFix"],
  implement: {
    getPrUrl: async () => null,
  },
};

describe("selectRegistry", () => {
  test("returns full registry when all capabilities are present", () => {
    const bus = createBus();
    const events: RalphEvent[] = [];
    bus.on("*", (e) => events.push(e));
    const active = selectRegistry(registry, FULL_CAPS, bus);
    expect(active).toHaveLength(registry.length);
    expect(events.filter((e) => /^feature\..+\.disabled$/.test(e.type))).toHaveLength(0);
  });

  test("filters gh-bundle features and emits feature.<id>.disabled with non-empty reason", () => {
    const bus = createBus();
    const events: RalphEvent[] = [];
    bus.on("*", (e) => events.push(e));
    const capsNoGh: Capabilities = {
      ...FULL_CAPS,
      gh: null,
    };
    const active = selectRegistry(registry, capsNoGh, bus);
    const activeIds = active.map((f) => f.id);

    expect(activeIds).not.toContain("conflict-fix");
    expect(activeIds).not.toContain("ci-fix");
    expect(activeIds).not.toContain("implement");
    expect(activeIds).not.toContain("review-followup");

    const disabled = events.filter((e) => /^feature\..+\.disabled$/.test(e.type)) as Array<
      RalphEvent & { type: string; reason: string }
    >;
    const disabledIds = disabled.map((e) =>
      e.type.replace(/^feature\./, "").replace(/\.disabled$/, ""),
    );
    expect(disabledIds).toContain("conflict-fix");
    expect(disabledIds).toContain("ci-fix");
    expect(disabledIds).toContain("implement");
    expect(disabledIds).toContain("review-followup");

    for (const e of disabled) {
      expect(typeof e.reason).toBe("string");
      expect(e.reason.length).toBeGreaterThan(0);
    }
  });

  test("filters linear-dependent features when linear capability missing", () => {
    const bus = createBus();
    const events: RalphEvent[] = [];
    bus.on("*", (e) => events.push(e));
    const capsNoLinear: Capabilities = {
      ...FULL_CAPS,
      linear: null,
    };
    const active = selectRegistry(registry, capsNoLinear, bus);
    const activeIds = active.map((f) => f.id);
    expect(activeIds).not.toContain("new-ticket");
    expect(activeIds).not.toContain("mention");
    expect(activeIds).not.toContain("stuck");

    const disabled = events.filter((e) => /^feature\..+\.disabled$/.test(e.type));
    expect(disabled.length).toBeGreaterThan(0);
  });
});
