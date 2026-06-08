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
      "openspec.reviewPhase.enabled",
      "openspec.reviewPhase.maxRounds",
      "openspec.reviewPhase.reviewerModel",
      "openspec.reviewPhase.reviewerContextStrategy",
    ],
  },
  {
    version: 2,
    description:
      "Ralphy now detects the current git repo and records it in WORKFLOW.md, " +
      "linking it to your Linear team. Confirm the detected repo to adopt it.",
    fields: ["repo.link"],
  },
  {
    version: 3,
    description:
      "The per-workflow `linear.assignee` setting is replaced by a global " +
      "`linear.filter` expression (e.g. `assignee = me`) applied to every " +
      "ticket fetch. Existing `assignee` values are folded in automatically; " +
      "note that an empty filter now defaults to `assignee = me` (it previously " +
      "meant unassigned-only).",
    fields: ["linear.assigneeChoice", "linear.assigneeValue"],
  },
  {
    version: 4,
    description:
      "A new additive `setPrReady` Linear indicator marks a ticket the moment its " +
      "PR is human-mergeable (ready, non-draft), layered on top of `setDone`. " +
      "Re-run the indicator builder to add it, or keep your current indicators.",
    fields: ["linear.indicators"],
  },
  {
    version: 5,
    description:
      "A new `linear.specAttachmentRevisions` setting controls the sealed " +
      "design attachment: 'replace' (default) overwrites the single canonical " +
      "attachment in place; 'append' publishes each change as a new " +
      "'Ralph design #N' attachment. Config-file-only — set it in WORKFLOW.md " +
      "if you want the append audit trail.",
    fields: [],
  },
  {
    version: 6,
    description:
      "PR recovery is unified under one `prRecovery` block (replacing " +
      "`prTracker`, `fixCiOnFailure`, `maxCiFixAttempts`, `ciPollIntervalSeconds`, " +
      "and `ignoreCiChecks`). Workers now open the PR and leave the ticket " +
      "in-review; a single background watcher advances it to done once the PR is " +
      "mergeable (CI green, no conflicts) and recovers red PRs — resolving merge " +
      "conflicts AND fixing failing CI (both `prRecovery.fixConflicts` and " +
      "`prRecovery.fixCi` default on; tune them in WORKFLOW.md). " +
      "`prRecovery.enabled: false` turns the watcher off everywhere and marks the " +
      "ticket done immediately on PR open. Your old values are migrated " +
      "automatically; review them here or keep them.",
    fields: ["prRecovery.enabled", "prRecovery.maxRecoverySessions", "prRecovery.ignoreChecks"],
  },
  {
    version: 7,
    description:
      "Pick your issue tracker: Linear (default) or GitHub Issues. The new " +
      "`tracker.kind` switch selects the provider; choosing GitHub drives the " +
      "loop off `gh` issues, filtered by `github.issues.label`/`assignee` and " +
      "moved through the `github.issues.statusLabels` (in-progress / done / " +
      "error). Existing files default to Linear, so nothing changes unless you " +
      "switch.",
    fields: [
      "tracker.kind",
      "github.issues.repo",
      "github.issues.label",
      "github.issues.assignee",
      "github.issues.statusLabels.inProgress",
      "github.issues.statusLabels.done",
      "github.issues.statusLabels.error",
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
