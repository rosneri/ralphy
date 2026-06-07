import { describe, test, expect } from "bun:test";
import { migrateWorkflowMarkdown } from "../migrate/pr-recovery";
import { parseWorkflow } from "../workflow";
import { CURRENT_WORKFLOW_VERSION } from "../schema";

/** Wrap frontmatter in a minimal valid WORKFLOW.md. */
function wrap(yaml: string): string {
  return `---\n${yaml}\n---\nbody\n`;
}

describe("migrateWorkflowMarkdown (v5 → v6 prRecovery)", () => {
  test("maps the legacy keys into prRecovery and removes them", () => {
    const result = migrateWorkflowMarkdown(
      wrap(
        [
          "version: 5",
          "fixCiOnFailure: true",
          "maxCiFixAttempts: 9",
          "ciPollIntervalSeconds: 45",
          "ignoreCiChecks:",
          "  - flaky-e2e",
          "prTracker:",
          "  enabled: true",
          "  maxRecoveryAttempts: 4",
          "  advanceMergedToDone: true",
        ].join("\n"),
      ),
    );
    expect(result.changed).toBe(true);

    // Old keys are gone from the text.
    for (const key of [
      "fixCiOnFailure",
      "maxCiFixAttempts",
      "ciPollIntervalSeconds",
      "ignoreCiChecks",
      "prTracker",
      "advanceMergedToDone",
    ]) {
      expect(result.markdown).not.toContain(key);
    }

    const { config } = parseWorkflow(result.markdown);
    expect(config.version).toBe(CURRENT_WORKFLOW_VERSION);
    expect(config.prRecovery.enabled).toBe(true);
    expect(config.prRecovery.fixCi).toBe(true);
    // fixConflicts is carried forward from the always-on tracker, not the
    // fresh-init default (false) — existing users keep conflict recovery.
    expect(config.prRecovery.fixConflicts).toBe(true);
    expect(config.prRecovery.maxRecoverySessions).toBe(4);
    expect(config.prRecovery.ignoreChecks).toEqual(["flaky-e2e"]);
  });

  test("prTracker.enabled: false ⇒ recovery off, fixCi + fixConflicts off (no watcher loss surprise)", () => {
    const result = migrateWorkflowMarkdown(
      wrap("version: 5\nprTracker:\n  enabled: false\n  maxRecoveryAttempts: 3"),
    );
    const { config } = parseWorkflow(result.markdown);
    expect(config.prRecovery.enabled).toBe(false);
    expect(config.prRecovery.fixCi).toBe(false);
    expect(config.prRecovery.fixConflicts).toBe(false);
  });

  test("a tracker-enabled file preserves today's watcher CI + conflict recovery", () => {
    // Legacy default: prTracker on, fixCiOnFailure off. The watcher recovered CI
    // and conflicts because it was always-on — so both come up TRUE despite the
    // fresh-init default for fixConflicts being false.
    const result = migrateWorkflowMarkdown(
      wrap("version: 5\nfixCiOnFailure: false\nprTracker:\n  enabled: true"),
    );
    const { config } = parseWorkflow(result.markdown);
    expect(config.prRecovery.enabled).toBe(true);
    expect(config.prRecovery.fixCi).toBe(true);
    expect(config.prRecovery.fixConflicts).toBe(true);
    expect(config.prRecovery.maxRecoverySessions).toBe(3); // default
  });

  test("defaults fill when the legacy block is absent but a flat legacy key is present", () => {
    const result = migrateWorkflowMarkdown(wrap("version: 5\nfixCiOnFailure: true"));
    expect(result.changed).toBe(true);
    const { config } = parseWorkflow(result.markdown);
    // No prTracker block → enabled defaults true → fixCi true.
    expect(config.prRecovery.enabled).toBe(true);
    expect(config.prRecovery.fixCi).toBe(true);
  });

  test("is a no-op when no legacy key is present", () => {
    const already = wrap("version: 6\nprRecovery:\n  enabled: true\n  fixCi: false");
    const result = migrateWorkflowMarkdown(already);
    expect(result.changed).toBe(false);
    expect(result.markdown).toBe(already);
  });

  test("is idempotent — migrating the migrated output changes nothing", () => {
    const once = migrateWorkflowMarkdown(
      wrap("version: 5\nignoreCiChecks:\n  - x\nprTracker:\n  enabled: true"),
    );
    const twice = migrateWorkflowMarkdown(once.markdown);
    expect(twice.changed).toBe(false);
    expect(twice.markdown).toBe(once.markdown);
  });

  test("preserves a prRecovery block already present, only stripping leftover legacy keys", () => {
    const result = migrateWorkflowMarkdown(
      wrap(
        [
          "version: 5",
          "prRecovery:",
          "  enabled: false",
          "  fixCi: false",
          "  maxRecoverySessions: 9",
          "  ignoreChecks: []",
          "prTracker:",
          "  enabled: true",
        ].join("\n"),
      ),
    );
    expect(result.changed).toBe(true);
    expect(result.markdown).not.toContain("prTracker");
    const { config } = parseWorkflow(result.markdown);
    // Existing prRecovery wins; it is not clobbered from the stale prTracker.
    expect(config.prRecovery.enabled).toBe(false);
    expect(config.prRecovery.maxRecoverySessions).toBe(9);
  });

  test("leaves a file with no frontmatter untouched", () => {
    const plain = "no frontmatter here";
    const result = migrateWorkflowMarkdown(plain);
    expect(result.changed).toBe(false);
    expect(result.markdown).toBe(plain);
  });
});

describe("migrateWorkflowMarkdown (legacy linear.filter string → marker list)", () => {
  test("converts `assignee = me` into a single assignee marker and parses", () => {
    const result = migrateWorkflowMarkdown(wrap("version: 6\nlinear:\n  filter: assignee = me"));
    expect(result.changed).toBe(true);
    // Serialized as a grep-friendly block list, never inline JSON.
    expect(result.markdown).toContain("- type: assignee");
    expect(result.markdown).not.toContain("filter: assignee = me");
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "me" }]);
  });

  test.each([
    ["assignee = any", "any"],
    ["assignee = unassigned", "unassigned"],
    ["", "me"],
    ["assignee = teammate@doorloop.com", "teammate@doorloop.com"],
  ])("maps the string %p to assignee value %p", (input, value) => {
    const result = migrateWorkflowMarkdown(wrap(`version: 6\nlinear:\n  filter: ${input}`));
    expect(result.changed).toBe(true);
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.filter).toEqual([{ type: "assignee", value }]);
  });

  test("drops the retired linear.assignee key when it rewrites a string filter", () => {
    const result = migrateWorkflowMarkdown(
      wrap("version: 6\nlinear:\n  assignee: me\n  filter: assignee = me"),
    );
    expect(result.changed).toBe(true);
    expect(result.markdown).not.toMatch(/^\s*assignee: me$/m);
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "me" }]);
  });

  test("a marker-list filter is left unchanged (idempotent)", () => {
    const input = wrap(
      ["version: 6", "linear:", "  filter:", "    - type: assignee", "      value: me"].join("\n"),
    );
    const result = migrateWorkflowMarkdown(input);
    expect(result.changed).toBe(false);
    expect(result.markdown).toBe(input);
  });

  test("converting a string filter twice is idempotent", () => {
    const once = migrateWorkflowMarkdown(wrap("version: 6\nlinear:\n  filter: assignee = me"));
    const twice = migrateWorkflowMarkdown(once.markdown);
    expect(twice.changed).toBe(false);
    expect(twice.markdown).toBe(once.markdown);
  });

  test("migrates the string filter alongside the v5→v6 prRecovery keys in one pass", () => {
    const result = migrateWorkflowMarkdown(
      wrap(
        [
          "version: 5",
          "prTracker:",
          "  enabled: true",
          "  maxRecoveryAttempts: 4",
          "linear:",
          "  assignee: me",
          "  filter: assignee = me",
        ].join("\n"),
      ),
    );
    expect(result.changed).toBe(true);
    expect(result.markdown).not.toContain("prTracker");
    const { config } = parseWorkflow(result.markdown);
    expect(config.version).toBe(CURRENT_WORKFLOW_VERSION);
    expect(config.prRecovery.maxRecoverySessions).toBe(4);
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "me" }]);
  });
});
