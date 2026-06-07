/**
 * Versioned WORKFLOW.md migration into the current frontmatter shape. Two
 * independent legacy-shape rewrites, both comment-preserving and idempotent:
 *
 * 1. PR recovery (v5 → v6): the six pre-v6 keys —
 *      - `prTracker.{enabled,maxRecoveryAttempts,advanceMergedToDone}`
 *      - `fixCiOnFailure`, `maxCiFixAttempts`, `ciPollIntervalSeconds`, `ignoreCiChecks`
 *      - the `ci.{fix_on_failure,max_attempts,poll_interval_seconds}` nested alias
 *    collapse into one block:
 *      prRecovery: { enabled, fixCi, fixConflicts, maxRecoverySessions, ignoreChecks }
 *
 *    Mapping (in-worker CI/conflict recovery no longer exists; the watcher owns
 *    all recovery, so the in-worker-only knobs are dropped, not carried over):
 *      enabled             ← prTracker.enabled                 (default true)
 *      fixCi               ← prTracker.enabled !== false        — preserves today's
 *                            always-on watcher CI recovery; the standalone
 *                            `fixCiOnFailure` controlled the removed in-worker loop
 *                            and is intentionally NOT migrated.
 *      fixConflicts        ← prTracker.enabled !== false        — preserves today's
 *                            always-on watcher conflict recovery (defaults on, like
 *                            fixCi; an explicit tracker-off config maps both off).
 *      maxRecoverySessions ← prTracker.maxRecoveryAttempts      (default 3)
 *      ignoreChecks        ← ignoreCiChecks                     (default [])
 *      (dropped: advanceMergedToDone, maxCiFixAttempts, ciPollIntervalSeconds, ci.*)
 *
 * 2. Linear filter (RLF-211): the removed `linear.filter` string grammar
 *    (`assignee = <value>`) becomes the marker list the schema now requires.
 *    The breaking change that introduced the marker form shipped without a
 *    forward-migration, so old files fail to parse on `linear.filter` until this
 *    converts them. The now-retired `linear.assignee` key is dropped at the same
 *    time (the schema folds it into the filter on parse anyway).
 *
 * Pure, idempotent, comment-preserving text transform — mirrors `normalize.ts`.
 * Returns the input unchanged (`changed: false`) when no legacy shape is present.
 * Runs inside `loadWorkflow` BEFORE the defaults-fill so a stale file is mapped
 * from its real values rather than back-filled with defaults.
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

function hasLegacyPrRecoveryKey(document: YAML.Document): boolean {
  if (!YAML.isMap(document.contents)) return false;
  return LEGACY_TOP_LEVEL_KEYS.some((key) => document.hasIn([key]));
}

/**
 * True when `linear.filter` is still a scalar (the removed string grammar)
 * rather than the marker list the schema now requires. A block list is already
 * the current shape; an empty `filter:` parses as a null scalar and is treated
 * as legacy (it converts to the default `assignee = me` marker).
 */
function hasLegacyLinearFilter(document: YAML.Document): boolean {
  if (!YAML.isMap(document.contents)) return false;
  if (!document.hasIn(["linear", "filter"])) return false;
  return YAML.isScalar(document.getIn(["linear", "filter"], true));
}

/**
 * Convert a pre-#362 `linear.filter` string into the marker list. The old
 * grammar recognized exactly `assignee = <value>` (blank meaning `me`); any
 * other form never loaded, so it falls back to the schema default rather than
 * mangling it. Keyword values normalize to lower case; emails / user-ids keep
 * their original case for Linear's case-sensitive lookups.
 */
function scalarFilterToMarkers(raw: unknown): { type: "assignee"; value: string }[] {
  const text = typeof raw === "string" ? raw.trim() : "";
  let value = "me";
  if (text !== "") {
    const equals = text.indexOf("=");
    const key = equals >= 0 ? text.slice(0, equals).trim().toLowerCase() : "assignee";
    const candidate = equals >= 0 ? text.slice(equals + 1).trim() : text;
    if (key === "assignee" && candidate !== "") value = candidate;
  }
  const lower = value.toLowerCase();
  if (lower === "unassigned" || lower === "any" || lower === "me") value = lower;
  return [{ type: "assignee", value }];
}

/**
 * Rewrite a stale WORKFLOW.md into the current frontmatter shape. Idempotent: a
 * file already in the current shape (no legacy keys, a marker-list filter) is
 * returned unchanged. A present `prRecovery` block is preserved — only the
 * leftover legacy keys are stripped.
 */
export function migrateWorkflowMarkdown(markdown: string): MigrateResult {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { markdown, changed: false };
  const document = YAML.parseDocument(match[1] ?? "");
  if (!YAML.isMap(document.contents)) return { markdown, changed: false };

  const prRecoveryLegacy = hasLegacyPrRecoveryKey(document);
  const linearFilterLegacy = hasLegacyLinearFilter(document);
  if (!prRecoveryLegacy && !linearFilterLegacy) return { markdown, changed: false };

  const body = match[2] ?? "";

  if (prRecoveryLegacy) {
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
  }

  if (linearFilterLegacy) {
    const markers = scalarFilterToMarkers(document.getIn(["linear", "filter"]));
    document.setIn(["linear", "filter"], document.createNode(markers, { flow: false }));
    // `linear.assignee` is the retired per-workflow key; the schema folds it
    // into the filter on parse, so drop it now that a real filter exists.
    document.deleteIn(["linear", "assignee"]);
  }

  document.setIn(["version"], CURRENT_WORKFLOW_VERSION);

  const frontmatter = document.toString({ flowCollectionPadding: false }).replace(/\n+$/, "");
  return { markdown: `---\n${frontmatter}\n---\n${body}`, changed: true };
}
