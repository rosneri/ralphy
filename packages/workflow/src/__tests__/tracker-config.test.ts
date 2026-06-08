import { describe, expect, test } from "bun:test";
import { WorkflowConfigSchema } from "../schema";

/** Parse a partial config object straight through the schema (defaults fill in). */
function parse(input: Record<string, unknown>) {
  return WorkflowConfigSchema.parse(input);
}

describe("tracker.kind config", () => {
  test("an absent tracker block defaults to kind: linear (no-regression case)", () => {
    const config = parse({});
    expect(config.tracker.kind).toBe("linear");
  });

  test("explicit kind: github is accepted", () => {
    const config = parse({ tracker: { kind: "github" } });
    expect(config.tracker.kind).toBe("github");
  });

  test("an unknown tracker.kind is rejected", () => {
    expect(() => parse({ tracker: { kind: "jira" } })).toThrow();
  });

  test("a stray key on the tracker block is rejected (.strict)", () => {
    expect(() => parse({ tracker: { kind: "linear", extra: true } })).toThrow();
  });
});

describe("github.issues block", () => {
  test("a github block without issues still validates", () => {
    const config = parse({ github: { base_branch: "main" } });
    expect(config.github?.base_branch).toBe("main");
    expect(config.github?.issues).toBeUndefined();
  });

  test("github.issues with partial statusLabels fills the ralph:* defaults", () => {
    const config = parse({
      github: { issues: { statusLabels: { inProgress: "wip" } } },
    });
    expect(config.github?.issues?.statusLabels).toEqual({
      inProgress: "wip",
      done: "ralph:done",
      error: "ralph:error",
    });
  });

  test("github.issues with no statusLabels fills every default", () => {
    const config = parse({ github: { issues: { repo: "acme/app", label: "ready" } } });
    expect(config.github?.issues?.repo).toBe("acme/app");
    expect(config.github?.issues?.label).toBe("ready");
    expect(config.github?.issues?.statusLabels).toEqual({
      inProgress: "ralph:in-progress",
      done: "ralph:done",
      error: "ralph:error",
    });
  });

  test("a stray key on github.issues is rejected (.strict)", () => {
    expect(() => parse({ github: { issues: { project: "x" } } })).toThrow();
  });
});
