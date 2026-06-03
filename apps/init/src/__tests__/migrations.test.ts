import { describe, test, expect } from "bun:test";
import { CURRENT_WORKFLOW_VERSION } from "@ralphy/workflow";
import {
  MIGRATIONS,
  LATEST_MIGRATION_VERSION,
  fieldsAddedSince,
  pendingMigrations,
  needsMigration,
} from "../migrations";
import { fieldsForMode } from "@ralphy/workflow/fields";

describe("migrations registry", () => {
  test("CURRENT_WORKFLOW_VERSION equals the latest migration version", () => {
    expect(LATEST_MIGRATION_VERSION).toBe(CURRENT_WORKFLOW_VERSION);
    expect(CURRENT_WORKFLOW_VERSION).toBe(4);
  });

  test("version 2 introduces repo.link", () => {
    const v2 = MIGRATIONS.find((m) => m.version === 2);
    expect(v2?.fields).toContain("repo.link");
  });

  test("version 3 introduces linear.filter", () => {
    const v3 = MIGRATIONS.find((m) => m.version === 3);
    expect(v3?.fields).toContain("linear.filter");
  });

  test("version 4 offers the indicators block (for the new setPrReady marker)", () => {
    const v4 = MIGRATIONS.find((m) => m.version === 4);
    expect(v4?.fields).toContain("linear.indicators");
  });

  test("every migration field id exists in the customized catalogue", () => {
    // Reveal nested gated children by enabling every field to a fixpoint. Seed
    // an injected repo identity so the `repo.link` step (gated on a detected
    // repo, not a walkthrough toggle) is also revealed.
    const known = new Set<string>();
    const answers: Record<string, boolean | string> = { "repo.name": "widgets" };
    for (let pass = 0; pass < 5; pass++) {
      for (const field of fieldsForMode("customized", answers)) {
        known.add(field.id);
        answers[field.id] = true;
      }
    }
    for (const migration of MIGRATIONS) {
      for (const id of migration.fields) {
        expect(known.has(id)).toBe(true);
      }
    }
  });

  test("fieldsAddedSince(0) is the union of all migration fields", () => {
    const expected = new Set(MIGRATIONS.flatMap((m) => m.fields));
    expect(new Set(fieldsAddedSince(0))).toEqual(expected);
  });

  test("a file at the current version has no pending migrations or diff", () => {
    expect(pendingMigrations(CURRENT_WORKFLOW_VERSION)).toEqual([]);
    expect(fieldsAddedSince(CURRENT_WORKFLOW_VERSION)).toEqual([]);
    expect(needsMigration(CURRENT_WORKFLOW_VERSION)).toBe(false);
  });

  test("a legacy (version 0) file needs migration", () => {
    expect(needsMigration(0)).toBe(true);
    expect(pendingMigrations(0).length).toBeGreaterThan(0);
  });
});
