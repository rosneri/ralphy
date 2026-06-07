import { describe, test, expect } from "bun:test";
import { CURRENT_WORKFLOW_VERSION } from "@ralphy/workflow";
import {
  MIGRATIONS,
  LATEST_MIGRATION_VERSION,
  fieldsAddedSince,
  pendingMigrations,
  needsMigration,
} from "../migrations";
import { findField } from "@ralphy/workflow/fields";

describe("migrations registry", () => {
  test("CURRENT_WORKFLOW_VERSION equals the latest migration version", () => {
    expect(LATEST_MIGRATION_VERSION).toBe(CURRENT_WORKFLOW_VERSION);
    expect(CURRENT_WORKFLOW_VERSION).toBe(6);
  });

  test("version 2 introduces repo.link", () => {
    const v2 = MIGRATIONS.find((m) => m.version === 2);
    expect(v2?.fields).toContain("repo.link");
  });

  test("version 3 introduces the Linear assignee filter", () => {
    const v3 = MIGRATIONS.find((m) => m.version === 3);
    expect(v3?.fields).toContain("linear.assigneeChoice");
    expect(v3?.fields).toContain("linear.assigneeValue");
  });

  test("version 4 offers the indicators block (for the new setPrReady marker)", () => {
    const v4 = MIGRATIONS.find((m) => m.version === 4);
    expect(v4?.fields).toContain("linear.indicators");
  });

  test("version 5 documents the sealed revision mode but offers NO wizard field (config-file-only)", () => {
    const v5 = MIGRATIONS.find((m) => m.version === 5);
    expect(v5?.description).toContain("specAttachmentRevisions");
    expect(v5?.fields).toEqual([]);
  });

  test("version 6 offers the unified prRecovery block", () => {
    const v6 = MIGRATIONS.find((m) => m.version === 6);
    expect(v6?.description).toContain("prRecovery");
    expect(v6?.fields).toEqual([
      "prRecovery.enabled",
      "prRecovery.maxRecoverySessions",
      "prRecovery.ignoreChecks",
    ]);
  });

  test("the retired prTracker / fixCiOnFailure field ids are gone from every migration", () => {
    const retired = [
      "prTracker.enabled",
      "prTracker.maxRecoveryAttempts",
      "prTracker.advanceMergedToDone",
      "fixCiOnFailure",
      "maxCiFixAttempts",
      "ciPollIntervalSeconds",
      "ignoreCiChecks",
    ];
    const allFields = MIGRATIONS.flatMap((m) => m.fields);
    for (const id of retired) expect(allFields).not.toContain(id);
  });

  test("linear.specAttachmentRevisions is NOT in the wizard catalogue (config-file-only)", () => {
    expect(findField("linear.specAttachmentRevisions")).toBeUndefined();
  });

  test("every migration field id exists in the customized catalogue", () => {
    // A migration may reference a hidden field (one kept in the catalogue for
    // its default/comment but never asked), so check catalogue membership via
    // findField rather than walkthrough reachability.
    for (const migration of MIGRATIONS) {
      for (const id of migration.fields) {
        expect(findField(id)).toBeDefined();
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
