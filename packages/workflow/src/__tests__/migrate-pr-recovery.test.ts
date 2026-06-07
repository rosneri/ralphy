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
