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

  test("linear.syncTasksToComment defaults to true", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.linear.syncTasksToComment).toBe(true);
  });

  test("linear.syncTasksToComment accepts explicit false", () => {
    const { config } = parseWorkflow(`---\nlinear:\n  syncTasksToComment: false\n---\n`);
    expect(config.linear.syncTasksToComment).toBe(false);
  });

  test("linear.mentionTrigger / codeReviewTrigger default to true", () => {
    const { config } = parseWorkflow(`---\nproject:\n  name: demo\n---\n`);
    expect(config.linear.mentionTrigger).toBe(true);
    expect(config.linear.codeReviewTrigger).toBe(true);
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
});
