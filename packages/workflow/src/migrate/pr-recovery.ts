/**
 * v5 → v6 WORKFLOW.md migration: unify PR-recovery config under `prRecovery`.
 *
 * The six pre-v6 keys —
 *   - `prTracker.{enabled,maxRecoveryAttempts,advanceMergedToDone}`
 *   - `fixCiOnFailure`, `maxCiFixAttempts`, `ciPollIntervalSeconds`, `ignoreCiChecks`
 *   - the `ci.{fix_on_failure,max_attempts,poll_interval_seconds}` nested alias
 * collapse into one block:
 *   prRecovery: { enabled, fixCi, fixConflicts, maxRecoverySessions, ignoreChecks }
 *
 * Mapping (in-worker CI/conflict recovery no longer exists; the watcher owns all
 * recovery, so the in-worker-only knobs are dropped, not carried over):
 *   enabled             ← prTracker.enabled                 (default true)
 *   fixCi               ← prTracker.enabled !== false        — preserves today's
 *                         always-on watcher CI recovery; the standalone
 *                         `fixCiOnFailure` controlled the removed in-worker loop
 *                         and is intentionally NOT migrated.
 *   fixConflicts        ← prTracker.enabled !== false        — preserves today's
 *                         always-on watcher conflict recovery (defaults on, like
 *                         fixCi; an explicit tracker-off config maps both off).
 *   maxRecoverySessions ← prTracker.maxRecoveryAttempts      (default 3)
 *   ignoreChecks        ← ignoreCiChecks                     (default [])
 *   (dropped: advanceMergedToDone, maxCiFixAttempts, ciPollIntervalSeconds, ci.*)
 *
 * Pure, idempotent, comment-preserving text transform — mirrors `normalize.ts`.
 * Returns the input unchanged (`changed: false`) when no pre-v6 key is present.
 * Runs inside `loadWorkflow` BEFORE the defaults-fill so a stale file is mapped
 * from its real values rather than back-filled with `prRecovery` defaults.
 */
import YAML from "yaml";
import { FRONTMATTER_RE } from "../default";
import { CURRENT_WORKFLOW_VERSION } from "../schema";

/** Pre-v6 frontmatter keys this migration consumes and removes. */
const LEGACY_TOP_LEVEL_KEYS = [
  "prTracker",
  "fixCiOnFailure",
  "maxCiFixAttempts",
  "ciPollIntervalSeconds",
  "ignoreCiChecks",
  "ci",
] as const;

export interface MigrateResult {
  markdown: string;
  changed: boolean;
}

function hasLegacyKey(document: YAML.Document): boolean {
  if (!YAML.isMap(document.contents)) return false;
  return LEGACY_TOP_LEVEL_KEYS.some((key) => document.hasIn([key]));
}

/**
 * Rewrite a pre-v6 WORKFLOW.md into the `prRecovery` shape. Idempotent: a file
 * that already has no legacy keys is returned unchanged. When `prRecovery` is
 * already present (e.g. a hand-edited file with leftover legacy keys), it is
 * preserved and only the legacy keys are stripped.
 */
export function migrateWorkflowMarkdown(markdown: string): MigrateResult {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { markdown, changed: false };
  const document = YAML.parseDocument(match[1] ?? "");
  if (!YAML.isMap(document.contents)) return { markdown, changed: false };
  if (!hasLegacyKey(document)) return { markdown, changed: false };

  const body = match[2] ?? "";

  // Synthesize `prRecovery` from the legacy values only when it isn't already
  // present, so a partially-migrated file's correct block is never clobbered.
  if (!document.hasIn(["prRecovery"])) {
    const trackerEnabled = document.getIn(["prTracker", "enabled"]);
    const enabled = trackerEnabled !== false; // default true; explicit false honored
    const maxRecovery = document.getIn(["prTracker", "maxRecoveryAttempts"]);
    const ignoreChecks = document.getIn(["ignoreCiChecks"]);

    document.setIn(["prRecovery", "enabled"], enabled);
    document.setIn(["prRecovery", "fixCi"], enabled);
    document.setIn(["prRecovery", "fixConflicts"], enabled);
    document.setIn(
      ["prRecovery", "maxRecoverySessions"],
      typeof maxRecovery === "number" ? maxRecovery : 3,
    );
    document.setIn(["prRecovery", "ignoreChecks"], YAML.isSeq(ignoreChecks) ? ignoreChecks : []);
  }

  for (const key of LEGACY_TOP_LEVEL_KEYS) document.deleteIn([key]);
  document.setIn(["version"], CURRENT_WORKFLOW_VERSION);

  const frontmatter = document.toString({ flowCollectionPadding: false }).replace(/\n+$/, "");
  return { markdown: `---\n${frontmatter}\n---\n${body}`, changed: true };
}
