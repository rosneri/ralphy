import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fieldsForMode, PROMPT_BODY_FIELD_ID, REPO_LINK_FIELD_ID } from "../fields";
import { LINEAR_ASSIGNEE_CHOICE_FIELD_ID, LINEAR_ASSIGNEE_VALUE_FIELD_ID } from "../fields";
import {
  COMMON_CLI_OPTIONS,
  cliOptionFieldExists,
  effortOptionValues,
  modelOptionValues,
} from "../schema-meta/cli-options";
import { enumValuesAt, schemaDefaults, schemaHasPath } from "../schema-meta/introspect";
import { WorkflowConfigSchema } from "../schema";

/**
 * The schema is the single source of truth for config shape and defaults; the
 * wizard catalogue and the CLI option table are metadata overlays keyed by
 * schema path. These invariants replace the old hand-maintained "fields and
 * schema stay in sync" duplication: a key renamed in the schema (or an overlay
 * entry pointing at a path that never existed) fails loudly here.
 */

/** Control / virtual field ids that deliberately have no schema path. */
const VIRTUAL_FIELD_IDS = new Set<string>([
  PROMPT_BODY_FIELD_ID,
  REPO_LINK_FIELD_ID,
  LINEAR_ASSIGNEE_CHOICE_FIELD_ID,
  LINEAR_ASSIGNEE_VALUE_FIELD_ID,
]);

/** Walk the full catalogue by enabling every toggle to a fixpoint. */
function allCatalogueFieldIds(): string[] {
  const answers: Record<string, boolean> = {};
  for (let pass = 0; pass < 6; pass++) {
    for (const field of fieldsForMode("customized", answers)) answers[field.id] = true;
  }
  return fieldsForMode("customized", answers).map((f) => f.id);
}

describe("schema-keyed overlay invariants", () => {
  test("every catalogue field id resolves to a real schema path", () => {
    for (const id of allCatalogueFieldIds()) {
      if (VIRTUAL_FIELD_IDS.has(id)) continue;
      expect(schemaHasPath(id.split("."))).toBe(true);
    }
  });

  test("every CLI option's fieldId resolves to a real schema path", () => {
    for (const option of COMMON_CLI_OPTIONS) {
      expect(cliOptionFieldExists(option)).toBe(true);
    }
  });

  test("CLI flags are unique and argKeys are unique", () => {
    const flags = COMMON_CLI_OPTIONS.map((o) => o.flag);
    const argKeys = COMMON_CLI_OPTIONS.map((o) => o.argKey);
    expect(new Set(flags).size).toBe(flags.length);
    expect(new Set(argKeys).size).toBe(argKeys.length);
  });

  test("enum-backed select fields read their options from the schema", () => {
    expect(enumValuesAt(["model"])).toEqual(["fable", "opus", "sonnet", "haiku"]);
    expect(enumValuesAt(["engine"])).toEqual(["claude", "codex"]);
    expect(enumValuesAt(["tracker", "kind"])).toEqual(["linear", "github"]);
    expect(enumValuesAt(["autoMergeStrategy"])).toEqual(["squash", "merge", "rebase"]);
    expect(enumValuesAt(["metaPrompt", "effort"])).toEqual(["auto", "light", "standard", "heavy"]);
    // Arrays of enums unwrap to their element enum (multiselect fields).
    expect(enumValuesAt(["linear", "specAttachmentFormats"])).toEqual(["md", "pdf"]);
    // Non-enum and unknown paths resolve to null, not a crash.
    expect(enumValuesAt(["concurrency"])).toBeNull();
    expect(enumValuesAt(["does", "not", "exist"])).toBeNull();
  });

  test("modelOptionValues comes from the schema enum", () => {
    expect(modelOptionValues()).toEqual(["fable", "opus", "sonnet", "haiku"]);
  });

  test("effortOptionValues comes from the schema enum", () => {
    expect(effortOptionValues()).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("schemaHasPath sees through default/optional/preprocess wrappers", () => {
    expect(schemaHasPath(["linear", "confirmationMode", "timeoutHours"])).toBe(true);
    expect(schemaHasPath(["openspec", "reviewPhase", "maxRounds"])).toBe(true);
    expect(schemaHasPath(["github", "issues", "statusLabels", "done"])).toBe(true);
    expect(schemaHasPath(["nope"])).toBe(false);
    expect(schemaHasPath(["linear", "nope"])).toBe(false);
  });

  test("schemaDefaults mirrors WorkflowConfigSchema.parse({})", () => {
    expect(schemaDefaults()).toEqual(WorkflowConfigSchema.parse({}));
  });

  test("zod wrapper unwrapping still works on this zod version", () => {
    // Canary for zod upgrades: the introspection module relies on `.unwrap()`
    // on the Default/Optional wrappers and `.out` on preprocess pipes.
    expect(z.string().default("x").unwrap() instanceof z.ZodString).toBe(true);
    expect(z.string().optional().unwrap() instanceof z.ZodString).toBe(true);
    const pipe = z.preprocess((v) => v, z.object({}));
    expect(pipe instanceof z.ZodPipe).toBe(true);
    expect(pipe.out instanceof z.ZodObject).toBe(true);
  });
});
