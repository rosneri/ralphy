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

  test("rejects status-typed clearConflicted", () => {
    expect(() =>
      parseWorkflow(
        `---\nlinear:\n  indicators:\n    clearConflicted:\n      type: status\n      value: Done\n---\n`,
      ),
    ).toThrow("invalid settings");
  });

  test("default workflow parses cleanly", () => {
    const { config } = parseWorkflow(DEFAULT_WORKFLOW_MD);
    expect(config.boundaries.never_touch).toContain("dist/**");
    expect(config.engine).toBe("claude");
  });

  test("agent.engine alias maps onto top-level engine", () => {
    const { config } = parseWorkflow(`---\nagent:\n  engine: codex\n  model: sonnet\n---\n`);
    expect(config.engine).toBe("codex");
    expect(config.model).toBe("sonnet");
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
