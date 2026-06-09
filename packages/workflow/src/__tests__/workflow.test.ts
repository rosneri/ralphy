import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflow,
  loadWorkflow,
  ensureWorkflow,
  renderTemplate,
  renderWorkflowPrompt,
  resolveBaselineCommands,
  workflowNeedsUpgrade,
  readWorkflowVersion,
  DEFAULT_WORKFLOW_MD,
} from "../workflow";
import { findBoundaryViolations } from "../boundaries";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "workflow-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("parseWorkflow", () => {
  test("parses frontmatter + body and applies schema defaults", () => {
    const { config, body } = parseWorkflow(
      `---\nconcurrency: 3\nproject:\n  name: demo\nrules:\n  - "be kind"\n---\nHello {{ issue.identifier }}\n`,
    );
    expect(config.concurrency).toBe(3);
    expect(config.project.name).toBe("demo");
    expect(config.rules).toEqual(["be kind"]);
    expect(config.linear.indicators).toEqual({});
    expect(body.trim()).toBe("Hello {{ issue.identifier }}");
  });

  test("rejects malformed frontmatter", () => {
    expect(() => parseWorkflow("no frontmatter")).toThrow("frontmatter");
  });

  test("project marker in getTodo.filter round-trips", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  indicators:\n    getTodo:\n      filter:\n        - type: project\n          value: "Ralph Queue"\n---\n`,
    );
    expect(config.linear.indicators.getTodo?.filter).toEqual([
      { type: "project", value: "Ralph Queue" },
    ]);
  });

  test("comment marker in getTodo.filter round-trips", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  indicators:\n    getTodo:\n      filter:\n        - type: comment\n          value: "ralph go"\n---\n`,
    );
    expect(config.linear.indicators.getTodo?.filter).toEqual([
      { type: "comment", value: "ralph go" },
    ]);
  });

  test("comment marker in setDone is rejected naming the slot", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    setDone:\n      type: comment\n      value: "ralph go"\n---\n`,
      ),
    ).toThrow(/setDone.*comment/);
  });

  test("setPrReady status marker parses (RLF-214)", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  indicators:\n    setPrReady:\n      type: status\n      value: "In Review"\n---\n`,
    );
    expect(config.linear.indicators.setPrReady).toEqual({
      type: "status",
      value: "In Review",
    });
  });

  test("comment marker in setPrReady is rejected naming the slot (RLF-214)", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    setPrReady:\n      type: comment\n      value: "ralph go"\n---\n`,
      ),
    ).toThrow(/setPrReady.*comment/);
  });

  test("comment marker with empty value is rejected", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    getTodo:\n      filter:\n        - type: comment\n          value: ""\n---\n`,
      ),
    ).toThrow("invalid settings");
  });

  // RLF-162 follow-up: nested label support via optional `group` on the
  // label marker variant. The resolver looks the label up as
  // `${group}:${value}` so labels living under a Linear parent label group
  // (e.g. `Ralphy:error`) can be referenced by their bare child name + group
  // — and the resolver never tries to create a duplicate.

  test("label marker with group field round-trips", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  indicators:\n    setError:\n      type: label\n      value: error\n      group: Ralphy\n---\n`,
    );
    expect(config.linear.indicators.setError).toEqual({
      type: "label",
      value: "error",
      group: "Ralphy",
    });
  });

  test("label marker without group still parses (group is optional)", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  indicators:\n    setError:\n      type: label\n      value: ralph:error\n---\n`,
    );
    expect(config.linear.indicators.setError).toEqual({
      type: "label",
      value: "ralph:error",
    });
  });

  test("non-label marker with group is rejected (group is label-only)", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    setInProgress:\n      type: status\n      value: In Progress\n      group: Ralphy\n---\n`,
      ),
    ).toThrow("invalid settings");
  });

  test("default workflow parses cleanly", () => {
    const { config } = parseWorkflow(DEFAULT_WORKFLOW_MD);
    expect(config.boundaries.never_touch).toContain("dist/**");
    expect(config.engine).toBe("claude");
  });

  test("boundaries.meta_only_files defaults cover openspec + meta files", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.boundaries.meta_only_files).toEqual([
      "openspec/**",
      ".ralph/**",
      "**/agent-tasks.md",
      "**/tasks.md",
      "**/MANUAL_TESTING*.md",
    ]);
  });

  test("boundaries.meta_only_files accepts custom override", () => {
    const { config } = parseWorkflow(
      `---\nboundaries:\n  never_touch: []\n  meta_only_files:\n    - "docs/**"\n---\n`,
    );
    expect(config.boundaries.meta_only_files).toEqual(["docs/**"]);
  });

  test("agent.engine alias maps onto top-level engine", () => {
    const { config } = parseWorkflow(`---\nagent:\n  engine: codex\n  model: sonnet\n---\n`);
    expect(config.engine).toBe("codex");
    expect(config.model).toBe("sonnet");
  });

  test("prLabels defaults to an empty list", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.prLabels).toEqual([]);
  });

  test("prLabels accepts an explicit list", () => {
    const { config } = parseWorkflow(`---\nprLabels:\n  - ralph\n  - automated\n---\n`);
    expect(config.prLabels).toEqual(["ralph", "automated"]);
  });

  test("github.pr_labels alias maps onto the flat prLabels", () => {
    const { config } = parseWorkflow(`---\ngithub:\n  pr_labels:\n    - ralph\n---\n`);
    expect(config.prLabels).toEqual(["ralph"]);
  });

  test("flat prLabels wins over github.pr_labels when both are set", () => {
    const { config } = parseWorkflow(
      `---\nprLabels:\n  - top\ngithub:\n  pr_labels:\n    - nested\n---\n`,
    );
    expect(config.prLabels).toEqual(["top"]);
  });

  test("linear.syncTasksToComment defaults to true", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.linear.syncTasksToComment).toBe(true);
  });

  test("linear.syncTasksToComment accepts explicit false", () => {
    const { config } = parseWorkflow(`---\nlinear:\n  syncTasksToComment: false\n---\n`);
    expect(config.linear.syncTasksToComment).toBe(false);
  });

  test("linear.filter defaults to an assignee = me marker", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "me" }]);
    expect((config.linear as Record<string, unknown>)["assignee"]).toBeUndefined();
  });

  test("legacy linear.assignee folds into a linear.filter marker", () => {
    const { config } = parseWorkflow(`---\nlinear:\n  assignee: me\n---\n`);
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "me" }]);
    expect((config.linear as Record<string, unknown>)["assignee"]).toBeUndefined();
  });

  test("legacy blank assignee folds to an unassigned marker", () => {
    const { config } = parseWorkflow(`---\nlinear:\n  assignee: ""\n---\n`);
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "unassigned" }]);
  });

  test("legacy assignee email folds into a filter marker", () => {
    const { config } = parseWorkflow(`---\nlinear:\n  assignee: dev@example.com\n---\n`);
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "dev@example.com" }]);
  });

  test("explicit linear.filter wins over a legacy assignee", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  assignee: me\n  filter:\n    - type: assignee\n      value: any\n---\n`,
    );
    expect(config.linear.filter).toEqual([{ type: "assignee", value: "any" }]);
  });

  test("linear.filter accepts label clauses alongside assignee", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  filter:\n    - type: assignee\n      value: me\n    - type: label\n      value: ralph\n---\n`,
    );
    expect(config.linear.filter).toEqual([
      { type: "assignee", value: "me" },
      { type: "label", value: "ralph" },
    ]);
  });

  test("linear.filter rejects more than one assignee clause", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  filter:\n    - type: assignee\n      value: me\n    - type: assignee\n      value: any\n---\n`,
      ),
    ).toThrow(/at most one "assignee"/);
  });

  test("linear.filter rejects a non label/assignee clause", () => {
    expect(() =>
      parseWorkflow(`---\nlinear:\n  filter:\n    - type: status\n      value: Todo\n---\n`),
    ).toThrow();
  });

  test("metaPrompt.effort defaults to auto", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.metaPrompt.effort).toBe("auto");
  });

  test("metaPrompt.effort accepts an explicit tier", () => {
    const { config } = parseWorkflow(`---\nmetaPrompt:\n  effort: light\n---\n`);
    expect(config.metaPrompt.effort).toBe("light");
  });

  test("metaPrompt.effort rejects an unknown value", () => {
    expect(() => parseWorkflow(`---\nmetaPrompt:\n  effort: gigantic\n---\n`)).toThrow();
  });

  test("linear.mentionTrigger / codeReviewTrigger default to true", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.linear.mentionTrigger).toBe(true);
    expect(config.linear.codeReviewTrigger).toBe(true);
  });

  test("parses an optional repo block", () => {
    const { config } = parseWorkflow(
      `---\nrepo:\n  remote: git@github.com:acme/widgets.git\n  host: github.com\n  owner: acme\n  name: widgets\n---\n`,
    );
    expect(config.repo).toEqual({
      remote: "git@github.com:acme/widgets.git",
      host: "github.com",
      owner: "acme",
      name: "widgets",
    });
  });

  test("a file without a repo block still validates (repo is undefined)", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.repo).toBeUndefined();
  });

  test("rejects an unknown key inside the strict repo block", () => {
    expect(() =>
      parseWorkflow(`---\nrepo:\n  owner: acme\n  name: widgets\n  branch: main\n---\n`),
    ).toThrow();
  });

  test("project marker in getTodo.filter round-trips through parseWorkflow", () => {
    const { config } = parseWorkflow(
      `---\nlinear:\n  indicators:\n    getTodo:\n      filter:\n        - type: project\n          value: "Ralph Queue"\n---\n`,
    );
    expect(config.linear.indicators.getTodo?.filter).toEqual([
      { type: "project", value: "Ralph Queue" },
    ]);
  });

  test("rejects inline JSON-array indicator filter", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    getTodo:\n      filter: "[{type: status, value: Todo}]"\n---\n`,
      ),
    ).toThrow("block-style list");
  });
});

describe("loadWorkflow / ensureWorkflow", () => {
  test("loadWorkflow returns defaults when no file exists", async () => {
    const { config } = await loadWorkflow(tempDir);
    expect(config.concurrency).toBe(1);
    expect(config.linear.indicators).toEqual({});
  });

  test("ensureWorkflow writes the canonical default and is idempotent", async () => {
    const path = await ensureWorkflow(tempDir);
    expect(path.endsWith("WORKFLOW.md")).toBe(true);
    const text1 = await Bun.file(path).text();
    expect(text1).toContain("project:");
    expect(text1).toContain("boundaries:");
    await ensureWorkflow(tempDir);
    const text2 = await Bun.file(path).text();
    expect(text2).toBe(text1);
  });

  test("loadWorkflow normalizes in-memory but does NOT write the file by default", async () => {
    const customPath = join(tempDir, "incomplete.md");
    const original = `---\nconcurrency: 7\n---\nbody\n`;
    await Bun.write(customPath, original);
    const { config } = await loadWorkflow(tempDir, customPath);
    // in-memory heal: defaults are present to the runtime
    expect(config.model).toBe("opus");
    expect(config.prRecovery.maxRecoverySessions).toBe(3);
    // but the file on disk is untouched (no hot-path / worktree churn)
    expect(await Bun.file(customPath).text()).toBe(original);
  });

  test("loadWorkflow with persist:true rewrites the healed file on disk", async () => {
    const customPath = join(tempDir, "persist.md");
    const original = `---\nconcurrency: 7\n---\nbody\n`;
    await Bun.write(customPath, original);
    await loadWorkflow(tempDir, customPath, { persist: true });
    const written = await Bun.file(customPath).text();
    expect(written).not.toBe(original);
    expect(written).toContain("model:");
    // idempotent: a second persist load makes no further change
    const afterFirst = written;
    await loadWorkflow(tempDir, customPath, { persist: true });
    expect(await Bun.file(customPath).text()).toBe(afterFirst);
  });

  test("loadWorkflow migrates pre-v6 PR-recovery keys from their REAL values before defaults-fill", async () => {
    // The ordering guard: if the defaults-fill ran first it would inject
    // prRecovery DEFAULTS (enabled/fixCi true, sessions 3) and lose this user's
    // real settings. Migrate-before-normalize must preserve them.
    const legacyPath = join(tempDir, "legacy.md");
    await Bun.write(
      legacyPath,
      `---\nversion: 5\nignoreCiChecks:\n  - flaky\nprTracker:\n  enabled: false\n  maxRecoveryAttempts: 7\n---\nbody\n`,
    );
    const { config } = await loadWorkflow(tempDir, legacyPath);
    expect(config.version).toBe(8);
    expect(config.prRecovery.enabled).toBe(false);
    expect(config.prRecovery.fixCi).toBe(false);
    expect(config.prRecovery.maxRecoverySessions).toBe(7);
    expect(config.prRecovery.ignoreChecks).toEqual(["flaky"]);
    // No persist → the on-disk file still carries the legacy shape untouched.
    expect(await Bun.file(legacyPath).text()).toContain("prTracker");
  });

  test("loadWorkflow injects getApproved for an enabled gate (in-memory)", async () => {
    const gatePath = join(tempDir, "gate.md");
    await Bun.write(gatePath, `---\nlinear:\n  confirmationMode:\n    enabled: true\n---\nbody\n`);
    const { config } = await loadWorkflow(tempDir, gatePath);
    expect(config.linear.indicators.getApproved?.filter).toEqual([
      { type: "label", value: "approved" },
    ]);
  });

  test("loadWorkflow reads from an explicit workflowFile override", async () => {
    const customPath = join(tempDir, "custom-workflow.md");
    await Bun.write(customPath, `---\nconcurrency: 7\n---\nbody\n`);
    const { config, path } = await loadWorkflow(tempDir, customPath);
    expect(path).toBe(customPath);
    expect(config.concurrency).toBe(7);
  });

  test("ensureWorkflow writes the default to an explicit workflowFile override", async () => {
    const customPath = join(tempDir, "nested", "custom-workflow.md");
    const path = await ensureWorkflow(tempDir, customPath);
    expect(path).toBe(customPath);
    expect(await Bun.file(customPath).exists()).toBe(true);
    expect(await Bun.file(customPath).text()).toContain("project:");
  });
});

describe("renderTemplate", () => {
  test("substitutes variables", () => {
    expect(renderTemplate("Hi {{ name }}!", { name: "Ada" })).toBe("Hi Ada!");
  });

  test("missing variable renders empty", () => {
    expect(renderTemplate("[{{ missing }}]", {})).toBe("[]");
  });

  test("if / else", () => {
    expect(renderTemplate("{% if x > 0 %}pos{% else %}neg{% endif %}", { x: 5 })).toBe("pos");
    expect(renderTemplate("{% if x > 0 %}pos{% else %}neg{% endif %}", { x: -1 })).toBe("neg");
  });

  test("for + join filter", () => {
    expect(
      renderTemplate(
        '{% for r in rules %}- {{ r }}\n{% endfor %}joined: {{ rules | join(", ") }}',
        { rules: ["a", "b"] },
      ),
    ).toBe("- a\n- b\njoined: a, b");
  });

  test("dotted lookup", () => {
    expect(renderTemplate("{{ issue.identifier }}", { issue: { identifier: "RLF-1" } })).toBe(
      "RLF-1",
    );
  });

  test("renderWorkflowPrompt threads issue.labels into context (join + for)", () => {
    const wf = parseWorkflow(
      `---\nproject:\n  name: demo\n---\n` +
        `labels={{ issue.labels | join(",") }}` +
        `{% for l in issue.labels %}{% if l == "deploy" %} SHIP{% endif %}{% endfor %}`,
    );
    const out = renderWorkflowPrompt(wf, {
      issue: { identifier: "RLF-1", labels: ["deploy", "bug"] },
    });
    expect(out).toBe("labels=deploy,bug SHIP");
  });

  test("renderWorkflowPrompt with no labels renders the falsy branch", () => {
    const wf = parseWorkflow(
      `---\nproject:\n  name: demo\n---\n` + `{% if issue.labels %}has{% else %}none{% endif %}`,
    );
    expect(renderWorkflowPrompt(wf, { issue: { labels: [] } })).toBe("none");
    expect(renderWorkflowPrompt(wf, { issue: {} })).toBe("none");
  });

  test("renderWorkflowPrompt threads project/rules/boundaries into context", () => {
    const wf = parseWorkflow(
      `---\nproject:\n  name: demo\nrules:\n  - "no foo"\nboundaries:\n  never_touch:\n    - "dist/**"\n---\n` +
        `proj={{ project.name }} rules={{ rules | join("/") }} nt={{ boundaries.never_touch | join("/") }}`,
    );
    const out = renderWorkflowPrompt(wf, {});
    expect(out).toBe("proj=demo rules=no foo nt=dist/**");
  });

  test("default workflow body does not include issue description (regression: proposal duplication)", () => {
    const wf = parseWorkflow(DEFAULT_WORKFLOW_MD);
    const description = "Users want a dark mode toggle in settings.";
    const out = renderWorkflowPrompt(wf, {
      issue: {
        identifier: "RLF-1",
        title: "Test issue",
        description,
        url: "https://linear.app/test",
        labels: [],
      },
      attempt: 1,
      last_error: "",
    });
    expect(out).not.toContain(description);
  });
});

describe("resolveBaselineCommands", () => {
  test("returns configured commands when set", () => {
    const { config } = parseWorkflow(
      `---\npreExistingErrorCheck:\n  enabled: true\n  commands:\n    - "echo a"\n    - "echo b"\n---\n`,
    );
    expect(resolveBaselineCommands(config)).toEqual(["echo a", "echo b"]);
  });

  test("falls back to lint + test when commands is empty", () => {
    const { config } = parseWorkflow(
      `---\ncommands:\n  lint: "bun run lint"\n  test: "bun test"\npreExistingErrorCheck:\n  enabled: true\n---\n`,
    );
    expect(resolveBaselineCommands(config)).toEqual(["bun run lint", "bun test"]);
  });

  test("returns empty list when nothing is configured", () => {
    const { config } = parseWorkflow(`---\npreExistingErrorCheck:\n  enabled: true\n---\n`);
    expect(resolveBaselineCommands(config)).toEqual([]);
  });
});

describe("findBoundaryViolations", () => {
  test("flags files matching glob patterns", () => {
    const v = findBoundaryViolations(
      ["src/app.ts", "dist/bundle.js", ".claude/worktrees/foo/x"],
      ["dist/**", ".claude/worktrees/**"],
    );
    expect(v.map((x) => x.file)).toEqual(["dist/bundle.js", ".claude/worktrees/foo/x"]);
  });

  test("no patterns → no violations", () => {
    expect(findBoundaryViolations(["dist/x"], [])).toEqual([]);
  });
});

describe("parseWorkflow — openspec.reviewPhase", () => {
  test("defaults: enabled false, maxRounds 1, strategy fresh", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.openspec.reviewPhase.enabled).toBe(false);
    expect(config.openspec.reviewPhase.maxRounds).toBe(1);
    expect(config.openspec.reviewPhase.reviewerContextStrategy).toBe("fresh");
    expect(config.openspec.reviewPhase.reviewerModel).toBeUndefined();
  });

  test("accepts explicit enabled: true with defaults", () => {
    const { config } = parseWorkflow(`---\nopenspec:\n  reviewPhase:\n    enabled: true\n---\n`);
    expect(config.openspec.reviewPhase.enabled).toBe(true);
    expect(config.openspec.reviewPhase.maxRounds).toBe(1);
  });

  test("accepts all valid fields", () => {
    const { config } = parseWorkflow(
      `---\nopenspec:\n  reviewPhase:\n    enabled: true\n    maxRounds: 3\n    reviewerModel: sonnet\n    reviewerContextStrategy: warm\n---\n`,
    );
    expect(config.openspec.reviewPhase.enabled).toBe(true);
    expect(config.openspec.reviewPhase.maxRounds).toBe(3);
    expect(config.openspec.reviewPhase.reviewerModel).toBe("sonnet");
    expect(config.openspec.reviewPhase.reviewerContextStrategy).toBe("warm");
  });

  test("rejects unknown keys under reviewPhase (strict)", () => {
    expect(() =>
      parseWorkflow(
        `---\nopenspec:\n  reviewPhase:\n    enabled: true\n    unknownKey: foo\n---\n`,
      ),
    ).toThrow();
  });

  test("rejects invalid reviewerContextStrategy value", () => {
    expect(() =>
      parseWorkflow(`---\nopenspec:\n  reviewPhase:\n    reviewerContextStrategy: invalid\n---\n`),
    ).toThrow();
  });
});

describe("S12 — hostile-config negative tests", () => {
  test("S12.1 — missing commands.test is accepted (optional field)", () => {
    const { config } = parseWorkflow(`---\ncommands:\n  lint: "bun run lint"\n---\n`);
    expect(config.commands.test).toBeUndefined();
    expect(config.commands.lint).toBe("bun run lint");
  });

  test('S12.2 — bad indicator type "branch" in getTodo.filter is rejected with enum error', () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    getTodo:\n      filter:\n        - type: branch\n          value: main\n---\n`,
      ),
    ).toThrow("invalid settings");
  });

  test("S12.8 — concurrency: -1 is rejected by positive() constraint", () => {
    expect(() => parseWorkflow(`---\nconcurrency: -1\n---\n`)).toThrow("invalid settings");
  });

  test("S12.9 — pollIntervalSeconds: 0 is rejected by positive() constraint", () => {
    expect(() => parseWorkflow(`---\npollIntervalSeconds: 0\n---\n`)).toThrow("invalid settings");
  });

  test("S12.10 — unknown top-level key is silently ignored (root not strict)", () => {
    const { config } = parseWorkflow(`---\nfoo: bar\nconcurrency: 2\n---\n`);
    expect(config.concurrency).toBe(2);
  });

  test("S12.12 — specAttachmentFormats: [] is rejected by nonempty() constraint", () => {
    expect(() => parseWorkflow(`---\nlinear:\n  specAttachmentFormats: []\n---\n`)).toThrow(
      "invalid settings",
    );
  });

  test("RLF-216 — linear.specAttachmentRevisions defaults to replace", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.linear.specAttachmentRevisions).toBe("replace");
  });

  test("RLF-216 — linear.specAttachmentRevisions accepts append", () => {
    const { config } = parseWorkflow(`---\nlinear:\n  specAttachmentRevisions: append\n---\n`);
    expect(config.linear.specAttachmentRevisions).toBe("append");
  });

  test("RLF-216 — linear.specAttachmentRevisions rejects an unknown value", () => {
    expect(() => parseWorkflow(`---\nlinear:\n  specAttachmentRevisions: clobber\n---\n`)).toThrow(
      "invalid settings",
    );
  });
});

describe("workflowNeedsUpgrade", () => {
  test("the canonical default WORKFLOW.md does not need an upgrade", () => {
    expect(workflowNeedsUpgrade(DEFAULT_WORKFLOW_MD)).toBe(false);
  });

  test("a file with the removed string linear.filter needs an upgrade", () => {
    expect(
      workflowNeedsUpgrade(`---\nversion: 6\nlinear:\n  filter: assignee = me\n---\nbody\n`),
    ).toBe(true);
  });

  test("a file with legacy prRecovery keys needs an upgrade", () => {
    expect(workflowNeedsUpgrade(`---\nversion: 5\nprTracker:\n  enabled: true\n---\nbody\n`)).toBe(
      true,
    );
  });

  test("a genuinely invalid file (still broken after migrate) needs an upgrade", () => {
    expect(
      workflowNeedsUpgrade(`---\nlinear:\n  specAttachmentRevisions: clobber\n---\nbody\n`),
    ).toBe(true);
  });

  test("a file missing only a default-bearing key self-heals in memory (no upgrade)", () => {
    // No legacy shape and parses fine — normalize backfills its defaults on
    // load, which is intentionally not an upgrade.
    expect(workflowNeedsUpgrade(`---\nproject:\n  name: demo\n---\nbody\n`)).toBe(false);
  });
});

describe("readWorkflowVersion", () => {
  test("reads the on-disk version stamp", () => {
    expect(readWorkflowVersion(`---\nversion: 5\n---\nbody\n`)).toBe(5);
  });

  test("defaults to 0 when version is missing", () => {
    expect(readWorkflowVersion(`---\nproject:\n  name: demo\n---\nbody\n`)).toBe(0);
  });

  test("defaults to 0 when there is no frontmatter", () => {
    expect(readWorkflowVersion(`no frontmatter`)).toBe(0);
  });

  test("reports the raw version even when other settings are invalid", () => {
    // The schema rejects a string linear.filter, but the version stamp is still
    // readable — this is exactly why init reads the disk version directly.
    expect(
      readWorkflowVersion(`---\nversion: 5\nlinear:\n  filter: assignee = me\n---\nbody\n`),
    ).toBe(5);
  });
});
