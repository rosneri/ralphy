/**
 * Unified outgoing-communication format for Ralphy.
 *
 * Every comment Ralphy posts — to Linear, to GitHub, sticky or one-shot —
 * leads with a single fixed title line, `🤖 Ralphy · <action>`, and carries a
 * hidden machine-readable marker (`<!-- ralphy:v=1 type=… -->`) so detectors
 * never have to parse human-facing prose to recognise Ralphy's own messages.
 *
 * Before this module, recognition was spread across fragile first-line regexes
 * (`isRalphComment`, `findLastRalphPickupISO`, an inline `startsWith("🤖 Ralph
 * started working")`). A reworded message silently broke dedup — the symptom
 * that re-acked the same Linear mention once per poll. The marker decouples the
 * human title from the parse, so wording can change freely.
 */

/** The invariant brand prefix. Every Ralphy comment's first line starts here. */
export const RALPHY_BRAND = "🤖 Ralphy";

/** First-line prefix joining the brand to a short action phrase. */
export const RALPHY_TITLE_PREFIX = `${RALPHY_BRAND} · `;

/** Marker schema version. Bump when the marker grammar changes. */
export const RALPHY_MARKER_VERSION = 1;

/**
 * Discriminator for every kind of comment Ralphy emits. Carried verbatim as the
 * marker's `type=` field; detectors switch on it instead of on prose.
 */
export type RalphyCommentType =
  | "mention-ack"
  | "started"
  | "progress"
  | "review-pickup"
  | "conflict-detected"
  | "ci-failed"
  | "promoted"
  | "verified"
  | "completed"
  | "conflicts-resolved"
  | "ci-fix-pushed"
  | "awaiting-ci"
  | "exited"
  | "completed-noop"
  | "recovery-gaveup"
  | "plan-ready"
  | "revise-ack"
  | "confirmation-reminder"
  | "confirmation-stuck"
  | "reviewer-ping"
  | "plan"
  | "steering"
  | "tasks"
  | "review-round"
  | "pr-body"
  | "attachment";

/** Parsed contents of a `<!-- ralphy:… -->` marker. */
export interface RalphyMarker {
  version: number;
  type: string;
  fields: Record<string, string>;
}

/** Strip anything that would break the `<!-- … -->` host or the `k=v` grammar. */
function sanitizeMarkerValue(value: string): string {
  return value.replace(/--+>?/g, "-").replace(/\s+/g, "_").trim();
}

/**
 * Build the hidden marker line. `fields` carries optional context (e.g.
 * `change`, `code`); empty values are dropped. Keys are assumed marker-safe
 * (no spaces) — values are sanitized.
 */
export function buildRalphyMarker(
  type: RalphyCommentType,
  fields?: Record<string, string | number | undefined>,
): string {
  const pairs = [`v=${RALPHY_MARKER_VERSION}`, `type=${type}`];
  for (const [key, raw] of Object.entries(fields ?? {})) {
    if (raw === undefined || raw === null || raw === "") continue;
    pairs.push(`${key}=${sanitizeMarkerValue(String(raw))}`);
  }
  return `<!-- ralphy:${pairs.join(" ")} -->`;
}

/** Parse the first typed `<!-- ralphy:… type=… -->` marker in a body, or null
 *  if absent. The `type=` requirement skips bare structural sentinels such as
 *  the tasks comment's `<!-- ralphy:tasks:start -->`, which would otherwise win
 *  the first match and shadow the real typed marker later in the same body. */
export function parseRalphyMarker(body: string): RalphyMarker | null {
  const match = /<!--\s*ralphy:([^>]*?\btype=[^>]*?)\s*-->/.exec(body);
  if (!match) return null;
  const fields: Record<string, string> = {};
  let type = "";
  let version = 0;
  for (const token of match[1]!.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq < 0) continue;
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    if (key === "v") version = Number(value) || 0;
    else if (key === "type") type = value;
    else fields[key] = value;
  }
  if (!type) return null;
  return { version, type, fields };
}

/** Minimal shape of a tracked comment the sticky finder scans over. */
export interface StickyCommentLike {
  /** Backend comment id (e.g. a GitHub GraphQL node id), if known. */
  id?: string;
  /** Raw comment body, scanned for the hidden Ralphy marker. */
  body: string;
}

/**
 * Find the first comment carrying a Ralphy marker of the given `type`, or
 * `null` when none matches. The backbone of the GitHub "sticky upsert" pattern:
 * a single marker-tagged comment is re-discovered by scanning the issue's
 * comments, so the upsert is stateless — correct even after a wiped worktree.
 *
 * First-wins on duplicates keeps a single canonical sticky comment even if a
 * second one ever slips in. A comment with no typed marker never matches, so
 * human comments that merely mention `ralphy:` are not hijacked.
 */
export function findStickyComment<T extends StickyCommentLike>(
  comments: readonly T[],
  type: RalphyCommentType,
): T | null {
  for (const comment of comments) {
    if (parseRalphyMarker(comment.body)?.type === type) return comment;
  }
  return null;
}

export interface RalphyCommentInput {
  /** Discriminator emitted into the marker. */
  type: RalphyCommentType;
  /** Short human phrase after `🤖 Ralphy · ` (lower-case, imperative-ish). */
  action: string;
  /** Optional detail lines rendered between the title and the marker. */
  body?: string;
  /** Extra marker fields (e.g. `{ change, code }`); empty values dropped. */
  fields?: Record<string, string | number | undefined>;
}

/**
 * Assemble a unified Ralphy comment: fixed title line, optional body, trailing
 * hidden marker. The marker sits last so it never interrupts rendered prose.
 */
export function buildRalphyComment(input: RalphyCommentInput): string {
  const lines = [`${RALPHY_TITLE_PREFIX}${input.action}`];
  const body = input.body?.trim();
  if (body) lines.push("", body);
  lines.push("", buildRalphyMarker(input.type, input.fields));
  return lines.join("\n");
}

/**
 * Legacy first-line leads from before the unified title (RLF). Already-posted
 * comments still carry these, so detection must keep recognising them during
 * and after the transition. `ℹ️` is included — its absence previously let the
 * "no code changes" completion comment slip past `isRalphComment`.
 */
const LEGACY_RALPH_LEAD = /^(🤖|🔄|✅|✗|❌|⚠️?|🔁|📋|⏰|ℹ️)\s*Ralphy?\b/u;
const LEGACY_MENTION_ACK = /^👀\s*(Got it\b|Acknowledged\b)/u;

/**
 * True when a comment body was authored by Ralphy. Recognises, in order: the
 * unified `🤖 Ralphy` title, any `<!-- ralphy:… -->` marker, and the legacy
 * emoji-led prefixes. Used by the mention/review scan to skip Ralphy's own
 * comments so it never re-triggers on them.
 */
export function isRalphyComment(body: string): boolean {
  const trimmed = body.trimStart();
  if (trimmed.startsWith(RALPHY_BRAND)) return true;
  if (parseRalphyMarker(body)) return true;
  if (LEGACY_RALPH_LEAD.test(trimmed)) return true;
  return LEGACY_MENTION_ACK.test(trimmed);
}

/**
 * True when a comment is a review-pickup acknowledgment — the marker that arms
 * the mention-scan dedup gate. Matches the `review-pickup` marker or the legacy
 * `🔁 Ralph picked up` lead.
 */
export function isPickupComment(body: string): boolean {
  if (parseRalphyMarker(body)?.type === "review-pickup") return true;
  return /^🔁\s*Ralph picked up/u.test(body.trimStart());
}

/**
 * True when a comment is the "started working" announcement — used by the
 * coordinator's resume-detection to avoid double-posting on restart. Matches
 * the `started` marker or the legacy `🤖 Ralph started working` lead.
 */
export function isStartedComment(body: string): boolean {
  if (parseRalphyMarker(body)?.type === "started") return true;
  return /^🤖\s*Ralph started working/u.test(body.trimStart());
}

/**
 * True when a comment is a mention acknowledgment ("picked up your mention").
 * The mention-scan uses the newest such comment as a dedup watermark so it
 * never re-acks a mention it has already answered — the gate that closes the
 * re-ack-every-poll loop on issues that are already in progress. Matches the
 * `mention-ack` marker or the legacy `👀 Got it` / `👀 Acknowledged` lead.
 */
export function isMentionAckComment(body: string): boolean {
  if (parseRalphyMarker(body)?.type === "mention-ack") return true;
  return LEGACY_MENTION_ACK.test(body.trimStart());
}
