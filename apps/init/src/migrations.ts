/**
 * WORKFLOW.md schema migrations.
 *
 * Each entry describes a version bump: the `version` it lands the file on, a
 * human `description` of what that version introduced (shown during migration),
 * and the wizard `fields` (dotted ids) that became available at that version.
 *
 * A file's "diff" — the new settings to fill in when migrating — is the union
 * of `fields` across every migration newer than the file's current version.
 * `CURRENT_WORKFLOW_VERSION` must equal the highest version here; a test keeps
 * the two in sync.
 */
import { CURRENT_WORKFLOW_VERSION } from "@ralphy/workflow";

interface Migration {
  version: number;
  description: string;
  /** Wizard field ids (dotted frontmatter paths) introduced at this version. */
  fields: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description:
      "WORKFLOW.md is now versioned. This release added the human confirmation " +
      "gate, stacked PRs, the PR recovery tracker, the OpenSpec review phase, the " +
      "base-branch health gate, and spec PDF attachments. Fill these in to adopt " +
      "them, or keep the defaults.",
    fields: [
      "stackPrsOnDependencies",
      "manualMergeWhenAutoMergeDisabled",
      "finalizeNoOpAsDone",
      "linear.specAttachmentFormats",
      "linear.confirmationMode.enabled",
      "linear.confirmationMode.timeoutHours",
      "linear.confirmationMode.maxConfirmationRounds",
      "preExistingErrorCheck.enabled",
      "preExistingErrorCheck.commands",
      "preExistingErrorCheck.baseBranch",
      "preExistingErrorCheck.label",
      "prTracker.enabled",
      "prTracker.maxRecoveryAttempts",
      "prTracker.advanceMergedToDone",
      "openspec.reviewPhase.enabled",
      "openspec.reviewPhase.maxRounds",
      "openspec.reviewPhase.reviewerModel",
      "openspec.reviewPhase.reviewerContextStrategy",
    ],
  },
];

/** The highest version any migration lands on. Asserted to equal CURRENT. */
export const LATEST_MIGRATION_VERSION = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

/** Migrations that move a file at `fromVersion` up to the latest version. */
export function pendingMigrations(fromVersion: number): Migration[] {
  return MIGRATIONS.filter((migration) => migration.version > fromVersion).sort(
    (a, b) => a.version - b.version,
  );
}

/** The wizard field ids a file at `fromVersion` has not been offered yet. */
export function fieldsAddedSince(fromVersion: number): string[] {
  const ids = new Set<string>();
  for (const migration of pendingMigrations(fromVersion)) {
    for (const id of migration.fields) ids.add(id);
  }
  return [...ids];
}

/** True when `version` is behind the current schema and can be migrated. */
export function needsMigration(version: number): boolean {
  return version < CURRENT_WORKFLOW_VERSION;
}
