import { describe, expect, test } from "bun:test";
import { parseWorkflow } from "../workflow";
import {
  computeConfirmationFlags,
  matchesIndicator,
  type ConfirmationTicketView,
} from "../confirmation";

function ticket(overrides: Partial<ConfirmationTicketView> = {}): ConfirmationTicketView {
  return {
    labels: [],
    state: { name: "Todo", type: "unstarted" },
    project: null,
    attachmentSourceTypes: [],
    ...overrides,
  };
}

function cfg(yaml: string) {
  return parseWorkflow(`---\n${yaml}\n---\n`).config;
}

describe("schema defaults — confirmationMode", () => {
  test("defaults: disabled, sensible opt-out, sensible timeout/round cap", () => {
    const c = cfg("");
    expect(c.linear.confirmationMode).toEqual({
      enabled: false,
      optOutLabel: "ralph:auto-approve",
      timeoutHours: 48,
      maxConfirmationRounds: 3,
    });
  });

  test("optional getApproved / clearApproved indicators parse", () => {
    const c = cfg(
      `linear:\n  indicators:\n    getApproved:\n      filter:\n        - type: label\n          value: ralph:approved\n    clearApproved:\n      - type: label\n        value: ralph:approved\n`,
    );
    expect(c.linear.indicators.getApproved).toEqual({
      filter: [{ type: "label", value: "ralph:approved" }],
    });
    expect(c.linear.indicators.clearApproved).toEqual([{ type: "label", value: "ralph:approved" }]);
  });

  test("clearApproved rejects status-typed markers", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    clearApproved:\n      type: status\n      value: Approved\n---\n`,
      ),
    ).toThrow("invalid settings");
  });
});

describe("matchesIndicator", () => {
  test("returns false when indicator is undefined or empty", () => {
    expect(matchesIndicator(undefined, ticket())).toBe(false);
    expect(matchesIndicator({ filter: [] }, ticket())).toBe(false);
  });

  test("label marker matches when ticket carries that label", () => {
    expect(
      matchesIndicator(
        { filter: [{ type: "label", value: "ralph:approved" }] },
        ticket({ labels: ["other", "ralph:approved"] }),
      ),
    ).toBe(true);
  });

  test("status marker matches by state name", () => {
    expect(
      matchesIndicator(
        { filter: [{ type: "status", value: "Approved" }] },
        ticket({ state: { name: "Approved", type: "started" } }),
      ),
    ).toBe(true);
  });

  test("multiple types AND together; same-type values OR", () => {
    const ind = {
      filter: [
        { type: "label" as const, value: "a" },
        { type: "label" as const, value: "b" },
        { type: "status" as const, value: "Approved" },
      ],
    };
    expect(
      matchesIndicator(
        ind,
        ticket({ labels: ["b"], state: { name: "Approved", type: "started" } }),
      ),
    ).toBe(true);
    expect(
      matchesIndicator(ind, ticket({ labels: ["b"], state: { name: "Todo", type: "unstarted" } })),
    ).toBe(false);
  });
});

describe("computeConfirmationFlags", () => {
  test("ungated when confirmationMode disabled (default)", () => {
    const c = cfg("");
    expect(computeConfirmationFlags(c, ticket())).toEqual({
      confirmationGated: false,
      approved: false,
    });
  });

  test("gated when enabled and opt-out label absent", () => {
    const c = cfg(`linear:\n  confirmationMode:\n    enabled: true\n`);
    expect(computeConfirmationFlags(c, ticket()).confirmationGated).toBe(true);
  });

  test("opt-out label bypasses the gate", () => {
    const c = cfg(`linear:\n  confirmationMode:\n    enabled: true\n`);
    expect(
      computeConfirmationFlags(c, ticket({ labels: ["ralph:auto-approve"] })).confirmationGated,
    ).toBe(false);
  });

  test("optInLabel set but ticket lacks it → ungated", () => {
    const c = cfg(
      `linear:\n  confirmationMode:\n    enabled: true\n    optInLabel: ralph:needs-review\n`,
    );
    expect(computeConfirmationFlags(c, ticket()).confirmationGated).toBe(false);
  });

  test("optInLabel set and ticket has it → gated", () => {
    const c = cfg(
      `linear:\n  confirmationMode:\n    enabled: true\n    optInLabel: ralph:needs-review\n`,
    );
    expect(
      computeConfirmationFlags(c, ticket({ labels: ["ralph:needs-review"] })).confirmationGated,
    ).toBe(true);
  });

  test("custom optOutLabel honoured", () => {
    const c = cfg(`linear:\n  confirmationMode:\n    enabled: true\n    optOutLabel: skip-gate\n`);
    expect(computeConfirmationFlags(c, ticket({ labels: ["skip-gate"] })).confirmationGated).toBe(
      false,
    );
    expect(
      computeConfirmationFlags(c, ticket({ labels: ["ralph:auto-approve"] })).confirmationGated,
    ).toBe(true);
  });

  test("approved reflects getApproved indicator match", () => {
    const c = cfg(
      `linear:\n  confirmationMode:\n    enabled: true\n  indicators:\n    getApproved:\n      filter:\n        - type: label\n          value: ralph:approved\n`,
    );
    expect(computeConfirmationFlags(c, ticket({ labels: ["ralph:approved"] })).approved).toBe(true);
    expect(computeConfirmationFlags(c, ticket()).approved).toBe(false);
  });
});
