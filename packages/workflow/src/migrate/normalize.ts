/**
 * Generic WORKFLOW.md self-healing.
 *
 * Two independent passes, both idempotent and comment-preserving:
 *
 *  1. Defaults-fill — add any key that carries a static schema default but is
 *     absent from the file, using the schema's own default value. This is the
 *     "generic migration": new default-bearing settings backfill themselves
 *     without a bespoke per-version migration entry. It does NOT touch keys the
 *     user already set, nor optional keys with no default (`repo`, `project.name`,
 *     the alias blocks, the individual indicators).
 *
 *  2. Gate invariant — a live confirmation gate (`confirmationMode.enabled`)
 *     needs an approval signal (`getApproved`), otherwise the only thing that
 *     can clear the gate is the timeout. The defaults-fill can't cover this:
 *     `getApproved` is optional and conditional, so it has no static default.
 *     This pass injects the same `approved`-label default the setup wizard uses
 *     whenever the gate is on and no `getApproved` exists — making the gate
 *     correct no matter how the file was authored (wizard, transform, or hand).
 *
 * Runs on every `loadWorkflow`; the file is rewritten only when a pass actually
 * changes it. The `version` key is intentionally left alone — versioned,
 * interactive migrations (repo detection, the assignee→filter transform, the
 * indicator builder) still own the version bump.
 */
import YAML from "yaml";
import { WorkflowConfigSchema } from "../schema";
import { FRONTMATTER_RE } from "../default";
import { FIELD_DESCRIPTIONS } from "../fields";
import { toCommentLines } from "../wizard";

/**
 * Approval indicators injected when the confirmation gate is on but no
 * `getApproved` signal exists. Shared with the setup wizard so the wizard-built
 * and self-healed shapes stay identical.
 */
export const DEFAULT_APPROVAL_INDICATORS = {
  getApproved: { filter: [{ type: "label", value: "approved" }] },
  clearApproved: { type: "label", value: "approved" },
} as const;

/** Leaf paths (and their default values) for every key that carries a static
 *  schema default. Derived from `WorkflowConfigSchema.parse({})`, so it tracks
 *  the schema automatically — a new default-bearing field needs no edit here. */
function defaultLeafEntries(): { path: string[]; value: unknown }[] {
  const defaults = WorkflowConfigSchema.parse({}) as Record<string, unknown>;
  const entries: { path: string[]; value: unknown }[] = [];
  const walk = (node: unknown, prefix: string[]): void => {
    if (Array.isArray(node)) {
      entries.push({ path: prefix, value: node });
      return;
    }
    if (node && typeof node === "object") {
      const keys = Object.keys(node as Record<string, unknown>);
      // Skip empty objects (e.g. `indicators: {}`) — writing a bare `{}` is noise.
      if (keys.length === 0) return;
      for (const key of keys) walk((node as Record<string, unknown>)[key], [...prefix, key]);
      return;
    }
    entries.push({ path: prefix, value: node });
  };
  walk(defaults, []);
  // `version` is owned by the versioned migration flow, not the defaults-fill.
  return entries.filter((entry) => !(entry.path.length === 1 && entry.path[0] === "version"));
}

/** Stamp a key's frontmatter comment from the field catalogue, if one exists. */
function stampDescription(document: YAML.Document, path: string[]): void {
  const match = FIELD_DESCRIPTIONS.find(
    (description) =>
      description.path.length === path.length &&
      description.path.every((segment, index) => segment === path[index]),
  );
  if (!match) return;
  const parent = path.length === 1 ? document.contents : document.getIn(path.slice(0, -1), true);
  if (!YAML.isMap(parent)) return;
  const leaf = path[path.length - 1];
  const pair = parent.items.find(
    (item) => YAML.isScalar(item.key) && String(item.key.value) === leaf,
  );
  if (!pair || !YAML.isScalar(pair.key)) return;
  pair.key.commentBefore = toCommentLines(match.description);
}

/** Read a `filter:` node (a YAML sequence) as a plain marker array. */
function toMarkerArray(node: unknown): unknown[] {
  if (node == null) return [];
  const js = YAML.isNode(node) ? node.toJSON() : node;
  return Array.isArray(js) ? js : [];
}

/** Dedupe markers by structural equality, preserving first-seen order. */
function dedupeMarkers(markers: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const marker of markers) {
    const key = JSON.stringify(marker);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(marker);
  }
  return out;
}

export interface NormalizeResult {
  markdown: string;
  changed: boolean;
  /** Dotted paths added by this pass (for logging). */
  added: string[];
}

/**
 * Add any missing default-bearing keys and enforce the gate invariant. Returns
 * the original markdown unchanged (and `changed: false`) when nothing is missing
 * or the file has no parseable frontmatter.
 */
export function normalizeWorkflowMarkdown(markdown: string): NormalizeResult {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { markdown, changed: false, added: [] };
  const document = YAML.parseDocument(match[1] ?? "");
  if (!YAML.isMap(document.contents)) return { markdown, changed: false, added: [] };
  const body = match[2] ?? "";
  const added: string[] = [];

  // 1) Defaults-fill.
  for (const { path, value } of defaultLeafEntries()) {
    if (document.getIn(path) !== undefined) continue;
    document.setIn(path, value);
    stampDescription(document, path);
    added.push(path.join("."));
  }

  // 1.5) Fold getAutoApprove → getApproved. getAutoApprove duplicated
  //      getApproved's role (clear the gate for matching tickets); collapse its
  //      filter markers into getApproved (any-of) and drop the indicator.
  const autoApprovePath = ["linear", "indicators", "getAutoApprove"];
  if (document.getIn(autoApprovePath) !== undefined) {
    const merged = dedupeMarkers([
      ...toMarkerArray(document.getIn(["linear", "indicators", "getApproved", "filter"])),
      ...toMarkerArray(document.getIn([...autoApprovePath, "filter"])),
    ]);
    document.setIn(["linear", "indicators", "getApproved"], { filter: merged });
    stampDescription(document, ["linear", "indicators", "getApproved"]);
    document.deleteIn(autoApprovePath);
    added.push("linear.indicators.getApproved");
  }

  // 2) Gate invariant.
  const gateEnabled = document.getIn(["linear", "confirmationMode", "enabled"]) === true;
  const hasGetApproved = document.getIn(["linear", "indicators", "getApproved"]) !== undefined;
  if (gateEnabled && !hasGetApproved) {
    document.setIn(
      ["linear", "indicators", "getApproved"],
      DEFAULT_APPROVAL_INDICATORS.getApproved,
    );
    if (document.getIn(["linear", "indicators", "clearApproved"]) === undefined) {
      document.setIn(
        ["linear", "indicators", "clearApproved"],
        DEFAULT_APPROVAL_INDICATORS.clearApproved,
      );
    }
    added.push("linear.indicators.getApproved");
  }

  if (added.length === 0) return { markdown, changed: false, added: [] };
  const frontmatter = document.toString({ flowCollectionPadding: false }).replace(/\n+$/, "");
  return { markdown: `---\n${frontmatter}\n---\n${body}`, changed: true, added };
}
