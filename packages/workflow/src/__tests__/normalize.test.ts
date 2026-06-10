import { describe, expect, test } from "bun:test";
import { normalizeWorkflowMarkdown } from "../migrate/normalize";
import { parseWorkflow } from "../workflow";

const wrap = (yaml: string): string => `---\n${yaml}\n---\nBody stays put.\n`;

describe("normalizeWorkflowMarkdown — defaults-fill", () => {
  test("backfills missing default-bearing keys with their schema defaults", () => {
    const result = normalizeWorkflowMarkdown(wrap("version: 4\nconcurrency: 3"));
    expect(result.changed).toBe(true);
    const { config } = parseWorkflow(result.markdown);
    // user value preserved
    expect(config.concurrency).toBe(3);
    // defaults filled
    expect(config.model).toBe("opus");
    expect(config.prRecovery.maxRecoverySessions).toBe(3);
    // RLF-97: both CI and conflict recovery default ON.
    expect(config.prRecovery.fixCi).toBe(true);
    expect(config.prRecovery.fixConflicts).toBe(true);
    expect(config.linear.mentionHandle).toBe("@ralphy");
  });

  test("leaves keys the user already set untouched", () => {
    const result = normalizeWorkflowMarkdown(wrap("version: 4\nmodel: haiku"));
    const { config } = parseWorkflow(result.markdown);
    expect(config.model).toBe("haiku");
  });

  test("does not bump or invent the version key", () => {
    const result = normalizeWorkflowMarkdown(wrap("version: 2"));
    const { config } = parseWorkflow(result.markdown);
    expect(config.version).toBe(2);
  });

  test("is idempotent — a second pass changes nothing", () => {
    const once = normalizeWorkflowMarkdown(wrap("version: 4"));
    const twice = normalizeWorkflowMarkdown(once.markdown);
    expect(twice.changed).toBe(false);
    expect(twice.markdown).toBe(once.markdown);
  });

  test("returns unchanged when there is no frontmatter", () => {
    const result = normalizeWorkflowMarkdown("no frontmatter here");
    expect(result.changed).toBe(false);
  });
});

describe("normalizeWorkflowMarkdown — gate invariant", () => {
  const gateOnNoApproval = wrap(
    [
      "version: 4",
      "linear:",
      "  confirmationMode:",
      "    enabled: true",
      "  indicators:",
      "    getTodo:",
      "      filter:",
      "        - type: status",
      "          value: Todo",
    ].join("\n"),
  );

  test("injects getApproved + clearApproved when the gate is on but no approval signal exists", () => {
    const result = normalizeWorkflowMarkdown(gateOnNoApproval);
    expect(result.changed).toBe(true);
    expect(result.added).toContain("linear.indicators.getApproved");
    // re-parses cleanly (block-style filter is required by parseWorkflow)
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.indicators.getApproved?.filter).toEqual([
      { type: "label", value: "approved" },
    ]);
    expect(config.linear.indicators.clearApproved).toEqual({ type: "label", value: "approved" });
    // pre-existing indicator preserved
    expect(config.linear.indicators.getTodo?.filter).toEqual([{ type: "status", value: "Todo" }]);
  });

  test("does not add an approval signal when the gate is off", () => {
    const result = normalizeWorkflowMarkdown(
      wrap("version: 4\nlinear:\n  confirmationMode:\n    enabled: false"),
    );
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.indicators.getApproved).toBeUndefined();
  });

  test("does not overwrite a user-supplied getApproved", () => {
    const custom = wrap(
      [
        "version: 4",
        "linear:",
        "  confirmationMode:",
        "    enabled: true",
        "  indicators:",
        "    getApproved:",
        "      filter:",
        "        - type: label",
        "          value: go-ahead",
      ].join("\n"),
    );
    const result = normalizeWorkflowMarkdown(custom);
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.indicators.getApproved?.filter).toEqual([
      { type: "label", value: "go-ahead" },
    ]);
    expect(config.linear.indicators.clearApproved).toBeUndefined();
  });
});

describe("normalizeWorkflowMarkdown — getAutoApprove → getApproved fold", () => {
  test("merges getAutoApprove markers into getApproved and drops the indicator", () => {
    const md = wrap(
      "linear:\n  indicators:\n    getApproved:\n      filter:\n        - type: label\n          value: approved\n    getAutoApprove:\n      filter:\n        - type: label\n          value: auto-merge\n",
    );
    const result = normalizeWorkflowMarkdown(md);
    expect(result.changed).toBe(true);
    expect(result.markdown).not.toContain("getAutoApprove");
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.indicators.getApproved).toEqual({
      filter: [
        { type: "label", value: "approved" },
        { type: "label", value: "auto-merge" },
      ],
    });
  });

  test("creates getApproved from getAutoApprove when getApproved is absent", () => {
    const md = wrap(
      "linear:\n  indicators:\n    getAutoApprove:\n      filter:\n        - type: label\n          value: auto-merge\n",
    );
    const result = normalizeWorkflowMarkdown(md);
    expect(result.markdown).not.toContain("getAutoApprove");
    const { config } = parseWorkflow(result.markdown);
    expect(config.linear.indicators.getApproved).toEqual({
      filter: [{ type: "label", value: "auto-merge" }],
    });
  });

  test("dedupes a marker present in both getApproved and getAutoApprove", () => {
    const md = wrap(
      "linear:\n  indicators:\n    getApproved:\n      filter:\n        - type: label\n          value: auto-merge\n    getAutoApprove:\n      filter:\n        - type: label\n          value: auto-merge\n",
    );
    const { config } = parseWorkflow(normalizeWorkflowMarkdown(md).markdown);
    expect(config.linear.indicators.getApproved).toEqual({
      filter: [{ type: "label", value: "auto-merge" }],
    });
  });
});

describe("normalizeWorkflowMarkdown — alias fold before defaults-fill", () => {
  test("an alias-only key folds onto its flat key with the alias value, not the schema default", () => {
    const result = normalizeWorkflowMarkdown(`---\nagent:\n  engine: codex\n---\nbody\n`);
    expect(result.changed).toBe(true);
    expect(result.added).toContain("engine");
    const { config } = parseWorkflow(result.markdown);
    // The defaults-fill must not have shadowed the alias with `claude`.
    expect(config.engine).toBe("codex");
  });

  test("worktree.enabled folds before useWorktree's default backfills", () => {
    const result = normalizeWorkflowMarkdown(`---\nworktree:\n  enabled: true\n---\n`);
    const { config } = parseWorkflow(result.markdown);
    expect(config.useWorktree).toBe(true);
  });

  test("an explicitly written flat key is left alone by the alias fold", () => {
    const result = normalizeWorkflowMarkdown(`---\nengine: claude\nagent:\n  engine: codex\n---\n`);
    const { config } = parseWorkflow(result.markdown);
    expect(config.engine).toBe("claude");
    expect(result.added).not.toContain("engine");
  });

  test("the alias fold is idempotent", () => {
    const once = normalizeWorkflowMarkdown(`---\nagent:\n  engine: codex\n---\n`);
    const twice = normalizeWorkflowMarkdown(once.markdown);
    expect(twice.changed).toBe(false);
  });
});
