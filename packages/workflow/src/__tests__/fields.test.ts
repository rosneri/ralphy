import { describe, test, expect } from "bun:test";
import { fieldsForMode, findField, FIELD_DESCRIPTIONS, PROMPT_BODY_FIELD_ID } from "../fields";

describe("fieldsForMode", () => {
  test("quick and permissive ask only the three common fields", () => {
    expect(fieldsForMode("quick").map((f) => f.id)).toEqual([
      "project.name",
      "linear.team",
      "linear.assigneeChoice",
    ]);
    expect(fieldsForMode("permissive").map((f) => f.id)).toEqual(
      fieldsForMode("quick").map((f) => f.id),
    );
  });

  test("customized hides gated sub-fields until their toggle is on", () => {
    const off = fieldsForMode("customized", {}).map((f) => f.id);
    expect(off).not.toContain("cleanupWorktreeOnSuccess");
    expect(off).not.toContain("linear.confirmationMode.timeoutHours");
  });

  test("every `when` gate fires once its parent toggle is enabled", () => {
    // Enabling every field to a fixpoint invokes each gate predicate, so the
    // gated children (and the predicates themselves) are all exercised.
    const answers: Record<string, boolean> = {};
    for (let pass = 0; pass < 5; pass++) {
      for (const field of fieldsForMode("customized", answers)) answers[field.id] = true;
    }
    const ids = fieldsForMode("customized", answers).map((f) => f.id);
    for (const gated of [
      "cleanupWorktreeOnSuccess",
      "autoMergeStrategy",
      "linear.mentionHandle",
      "linear.codeReviewStaleHours",
      "linear.syncSpecsAsAttachments",
      "linear.specAttachmentFormats",
      "linear.confirmationMode.timeoutHours",
      "preExistingErrorCheck.baseBranch",
      "prRecovery.maxRecoverySessions",
    ]) {
      expect(ids).toContain(gated);
    }
  });

  test("restrictTo limits the walkthrough to the given ids (their gates still apply)", () => {
    expect(fieldsForMode("customized", {}, ["model"]).map((f) => f.id)).toEqual(["model"]);
    // A gated id stays hidden until its parent toggle is on, even when listed.
    expect(fieldsForMode("customized", {}, ["autoMergeStrategy"])).toHaveLength(0);
    expect(
      fieldsForMode("customized", { createPrOnSuccess: true }, ["autoMergeStrategy"]).map(
        (f) => f.id,
      ),
    ).toEqual(["autoMergeStrategy"]);
  });

  test("hidden fields are never asked, even when explicitly requested", () => {
    // These settings keep their schema default rather than being walked through.
    for (const hidden of [
      "appendPrompt",
      "metaPrompt.enabled",
      "prDraft",
      "manualMergeWhenAutoMergeDisabled",
      "finalizeNoOpAsDone",
      "logRawStream",
    ]) {
      expect(fieldsForMode("customized", {}).map((f) => f.id)).not.toContain(hidden);
      expect(fieldsForMode("customized", { createPrOnSuccess: true }, [hidden])).toHaveLength(0);
    }
  });
});

describe("catalogue lookups", () => {
  test("findField resolves real ids and rejects unknown ones", () => {
    expect(findField("model")?.label).toBe("Model tier");
    expect(findField("project.name")?.spec.kind).toBe("text");
    expect(findField("does.not.exist")).toBeUndefined();
  });

  test("the model select derives its options from the schema enum", () => {
    const field = findField("model");
    expect(field?.spec.kind).toBe("select");
    if (field?.spec.kind === "select") {
      expect(field.spec.options.map((o) => o.value)).toEqual(["opus", "sonnet", "haiku"]);
    }
  });

  test("tracker.kind keeps display labels over the schema values", () => {
    const field = findField("tracker.kind");
    expect(field?.spec.kind).toBe("select");
    if (field?.spec.kind === "select") {
      expect(field.spec.options).toEqual([
        { label: "Linear", value: "linear" },
        { label: "GitHub", value: "github" },
      ]);
    }
  });

  test("FIELD_DESCRIPTIONS covers settings but excludes the prompt-body step", () => {
    expect(FIELD_DESCRIPTIONS.length).toBeGreaterThan(20);
    expect(FIELD_DESCRIPTIONS.some((d) => d.path.join(".") === PROMPT_BODY_FIELD_ID)).toBe(false);
    expect(FIELD_DESCRIPTIONS.some((d) => d.path.join(".") === "concurrency")).toBe(true);
  });
});
