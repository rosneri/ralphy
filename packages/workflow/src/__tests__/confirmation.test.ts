import { describe, expect, test } from "bun:test";
import { parseWorkflow } from "../workflow";
import {
  computeConfirmationFlags,
  describeApprovalMarker,
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
  test("defaults: disabled, sensible timeout/round cap", () => {
    const c = cfg("");
    expect(c.linear.confirmationMode).toEqual({
      enabled: false,
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

  test("optional getConfirmGate indicator parses", () => {
    const c = cfg(
      `linear:\n  indicators:\n    getConfirmGate:\n      filter:\n        - type: label\n          value: ralph:needs-review\n`,
    );
    expect(c.linear.indicators.getConfirmGate).toEqual({
      filter: [{ type: "label", value: "ralph:needs-review" }],
    });
  });

  test("setAwaitingConfirmation accepts marker and marker[]", () => {
    const single = cfg(
      `linear:\n  indicators:\n    setAwaitingConfirmation:\n      type: label\n      value: ralph:awaiting-confirmation\n`,
    );
    expect(single.linear.indicators.setAwaitingConfirmation).toEqual({
      type: "label",
      value: "ralph:awaiting-confirmation",
    });
    const many = cfg(
      `linear:\n  indicators:\n    setAwaitingConfirmation:\n      - type: label\n        value: ralph:awaiting-confirmation\n      - type: status\n        value: Awaiting Confirmation\n`,
    );
    expect(many.linear.indicators.setAwaitingConfirmation).toEqual([
      { type: "label", value: "ralph:awaiting-confirmation" },
      { type: "status", value: "Awaiting Confirmation" },
    ]);
  });

  test("clearAwaitingConfirmation rejects status-typed markers (label-only)", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    clearAwaitingConfirmation:\n      type: status\n      value: Done\n---\n`,
      ),
    ).toThrow("invalid settings");
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

  test("project marker matches when ticket is in that project", () => {
    const ind = { filter: [{ type: "project" as const, value: "Platform" }] };
    expect(matchesIndicator(ind, ticket({ project: { id: "1", name: "Platform" } }))).toBe(true);
    expect(matchesIndicator(ind, ticket({ project: { id: "2", name: "Other" } }))).toBe(false);
    expect(matchesIndicator(ind, ticket({ project: null }))).toBe(false);
  });

  test("attachment marker matches when ticket has that attachment source type", () => {
    const ind = { filter: [{ type: "attachment" as const, value: "github" }] };
    expect(matchesIndicator(ind, ticket({ attachmentSourceTypes: ["github", "other"] }))).toBe(
      true,
    );
    expect(matchesIndicator(ind, ticket({ attachmentSourceTypes: ["other"] }))).toBe(false);
    expect(matchesIndicator(ind, ticket({ attachmentSourceTypes: [] }))).toBe(false);
  });

  test("comment marker matches when any non-Ralph comment body contains the text", () => {
    const ind = { filter: [{ type: "comment" as const, value: "approve" }] };
    expect(matchesIndicator(ind, ticket({ commentBodies: ["LGTM, I Approve this"] }))).toBe(true);
    expect(matchesIndicator(ind, ticket({ commentBodies: ["looks good"] }))).toBe(false);
    expect(matchesIndicator(ind, ticket({ commentBodies: [] }))).toBe(false);
    expect(matchesIndicator(ind, ticket())).toBe(false);
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

  test("gated when enabled (no opt-in indicator)", () => {
    const c = cfg(`linear:\n  confirmationMode:\n    enabled: true\n`);
    expect(computeConfirmationFlags(c, ticket()).confirmationGated).toBe(true);
  });

  test("a getApproved match reads as approved (folded auto-approve label)", () => {
    // getAutoApprove was folded into getApproved: a matching ticket is gated
    // (gate on) but reads `approved`, so the confirmation feature releases it.
    const c = cfg(
      `linear:\n  confirmationMode:\n    enabled: true\n  indicators:\n    getApproved:\n      filter:\n        - type: label\n          value: ralph:approved\n        - type: label\n          value: auto-merge\n`,
    );
    const autoMerge = computeConfirmationFlags(c, ticket({ labels: ["auto-merge"] }));
    expect(autoMerge).toEqual({ confirmationGated: true, approved: true });
    const plain = computeConfirmationFlags(c, ticket());
    expect(plain).toEqual({ confirmationGated: true, approved: false });
  });

  test("getConfirmGate set but ticket lacks it → ungated (opt-in mode)", () => {
    const c = cfg(
      `linear:\n  confirmationMode:\n    enabled: true\n  indicators:\n    getConfirmGate:\n      filter:\n        - type: label\n          value: ralph:needs-review\n`,
    );
    expect(computeConfirmationFlags(c, ticket()).confirmationGated).toBe(false);
  });

  test("getConfirmGate set and ticket matches → gated", () => {
    const c = cfg(
      `linear:\n  confirmationMode:\n    enabled: true\n  indicators:\n    getConfirmGate:\n      filter:\n        - type: label\n          value: ralph:needs-review\n`,
    );
    expect(
      computeConfirmationFlags(c, ticket({ labels: ["ralph:needs-review"] })).confirmationGated,
    ).toBe(true);
  });

  test("getConfirmGate opt-in: matched ticket is gated, approved via getApproved", () => {
    const c = cfg(
      `linear:\n  confirmationMode:\n    enabled: true\n  indicators:\n    getConfirmGate:\n      filter:\n        - type: label\n          value: ralph:needs-review\n    getApproved:\n      filter:\n        - type: label\n          value: auto-merge\n`,
    );
    // Opted in + auto-merge: gated but approved → released.
    expect(
      computeConfirmationFlags(c, ticket({ labels: ["ralph:needs-review", "auto-merge"] })),
    ).toEqual({ confirmationGated: true, approved: true });
    // Opted in, not approved: gated, awaits approval.
    expect(
      computeConfirmationFlags(c, ticket({ labels: ["ralph:needs-review"] })).confirmationGated,
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

describe("describeApprovalMarker", () => {
  test("returns generic fallback when indicator is undefined or empty", () => {
    expect(describeApprovalMarker(undefined)).toBe("ask your operator to approve this plan");
    expect(describeApprovalMarker({ filter: [] })).toBe("ask your operator to approve this plan");
  });

  test("single label marker returns label phrase", () => {
    expect(describeApprovalMarker({ filter: [{ type: "label", value: "ralph:approved" }] })).toBe(
      "apply the `ralph:approved` label",
    );
  });

  test("single status marker returns status phrase", () => {
    expect(describeApprovalMarker({ filter: [{ type: "status", value: "Approved" }] })).toBe(
      "move the issue to status `Approved`",
    );
  });

  test("single project marker returns project phrase", () => {
    expect(describeApprovalMarker({ filter: [{ type: "project", value: "Platform" }] })).toBe(
      "move the issue into project `Platform`",
    );
  });

  test("single attachment marker returns attachment phrase", () => {
    expect(describeApprovalMarker({ filter: [{ type: "attachment", value: "github" }] })).toBe(
      "attach a `github`",
    );
  });

  test("single comment marker returns comment phrase", () => {
    expect(describeApprovalMarker({ filter: [{ type: "comment", value: "approve" }] })).toBe(
      "post a comment containing `approve`",
    );
  });

  test("two markers joined with 'or'", () => {
    expect(
      describeApprovalMarker({
        filter: [
          { type: "label", value: "ralph:approved" },
          { type: "status", value: "Approved" },
        ],
      }),
    ).toBe("apply the `ralph:approved` label or move the issue to status `Approved`");
  });

  test("three or more markers joined with commas and trailing 'or'", () => {
    expect(
      describeApprovalMarker({
        filter: [
          { type: "label", value: "a" },
          { type: "label", value: "b" },
          { type: "status", value: "Done" },
        ],
      }),
    ).toBe("apply the `a` label, apply the `b` label, or move the issue to status `Done`");
  });
});
