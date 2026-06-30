/**
 * Compose the publishable spec source from a change directory and derive the
 * change-detection signals (seal state, trigger label, versioned titles) used
 * by the sync engine. These are leaf helpers shared by the attachment sync and
 * the comment-embedded SpecSink.
 */

import { join } from "node:path";
import { readSlotSidecar } from "@ralphy/core/state";
import { type LogFn, sha256Hex } from "../utils";
import { SLOT_SPECS, type Slot } from "./model";

/** True iff `bytes` (UTF-8 markdown) contain at least one line that
 *  isn't scaffold noise. Scaffold noise = blank lines, markdown headings,
 *  italic-only placeholder lines (`_..._`), and the `Source:` /
 *  `Status:` / `Assignee:` / `Labels:` metadata block emitted by
 *  `scaffoldChangeForIssue`. Used to keep first-iteration template
 *  stubs out of Linear. */
function hasMeaningfulContent(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (/^_.+_$/.test(line)) continue;
    if (/^(Source|Status|Assignee|Labels):/.test(line)) continue;
    return true;
  }
  return false;
}

/** Pull only the `## Implementation` section out of a tasks.md document for
 *  the Linear design attachment. Everything else is dropped: the `## Planning`
 *  process checklist (the agent's own planning tasks), the `# Tasks for …`
 *  title, and any other sections. Reviewers on Linear should see only the real
 *  implementation tasks — not the agent scaffolding. Capture runs from the
 *  `## Implementation` H2 up to (but not including) the next H2. Returns "" when
 *  no Implementation section exists yet (e.g. mid-planning), signalling the
 *  caller to upload design.md without any tasks section. */
export function extractImplementationSection(tasksMarkdown: string): string {
  const captured: string[] = [];
  let capturing = false;
  for (const line of tasksMarkdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading !== undefined) capturing = heading.trim().toLowerCase() === "implementation";
    if (capturing) captured.push(line);
  }
  return captured.join("\n").trim();
}

/** The composed spec source both sinks publish (attachment slots and the
 *  comment-embedded SpecSink). */
export interface ComposedSpecSource {
  /** design.md + appended tasks.md `## Implementation` section, markdown. */
  sourceBytes: Uint8Array;
  /** sha256 of the composed bytes — the pre-seal change-detection key. */
  hash: string;
  /** sha256 of design.md alone — the post-seal key, so a checkbox-only tick
   *  of the tasks.md Implementation checklist is not mistaken for a design
   *  revision. */
  designOnlyHash: string;
}

/**
 * Compose the publishable spec source from a change directory: the primary
 * file (design.md) with any present trailing source files appended, separated
 * by a markdown rule so reviewers can tell the sections apart. tasks.md is
 * special-cased: only its `## Implementation` section is published — the
 * `## Planning` checklist (agent process tasks) must never reach the tracker.
 * Returns null (with a log line) when the primary file is missing, unreadable,
 * or still scaffold-only.
 */
export async function composeSpecSource(
  changeDir: string,
  log: LogFn,
  sourceFiles: string[] = SLOT_SPECS.design.sourceFiles,
): Promise<ComposedSpecSource | null> {
  const [primaryName, ...trailingNames] = sourceFiles;
  if (!primaryName) return null;
  const primary = Bun.file(join(changeDir, primaryName));
  if (!(await primary.exists())) {
    log(`  spec-attachments: ${primaryName} missing, skipping`, "gray");
    return null;
  }

  let primaryBytes: Uint8Array;
  try {
    primaryBytes = await primary.bytes();
  } catch (err) {
    log(`! spec-attachments: read ${primaryName} failed: ${(err as Error).message}`, "yellow");
    return null;
  }

  if (!hasMeaningfulContent(primaryBytes)) {
    log(`  spec-attachments: ${primaryName} has no content yet, skipping`, "gray");
    return null;
  }

  const parts: Uint8Array[] = [primaryBytes];
  const enc = new TextEncoder();
  for (const name of trailingNames) {
    const f = Bun.file(join(changeDir, name));
    if (!(await f.exists())) continue;
    let raw: Uint8Array;
    try {
      raw = await f.bytes();
    } catch (err) {
      log(
        `! spec-attachments: read ${name} failed (continuing without it): ${(err as Error).message}`,
        "yellow",
      );
      continue;
    }
    if (raw.length === 0) continue;
    const decoded = new TextDecoder().decode(raw);
    const body = name === "tasks.md" ? extractImplementationSection(decoded) : decoded.trim();
    if (!body) continue;
    parts.push(enc.encode(`\n\n---\n\n${body}\n`));
  }
  const totalLen = parts.reduce((n, p) => n + p.length, 0);
  const sourceBytes = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    sourceBytes.set(p, offset);
    offset += p.length;
  }

  // Hash the *composed* source so the md and pdf slots track the same
  // content signal; the design-only hash narrows post-seal change detection.
  return { sourceBytes, hash: sha256Hex(sourceBytes), designOnlyHash: sha256Hex(primaryBytes) };
}

/**
 * A change is **sealed** once a PR exists for it. After sealing, a changed
 * design.md is published as a new versioned attachment rather than
 * overwriting the v1 one in place. Detected by reading sidecars next to
 * `.ralph-state.json`:
 *
 *   - `pr` sidecar has a non-empty `url` (set by `writePrUrl`), OR
 *   - `confirmation` sidecar has a non-null `earlyDraftPrAt` (the prDraft
 *     early draft PR opened at design-ready).
 *
 * Read failures resolve to `false` (safe default: in-place update, never
 * accidental versioning). Never throws.
 */
export async function isDesignSealed(stateDir: string): Promise<boolean> {
  try {
    const pr = await readSlotSidecar(stateDir, "pr");
    const url = pr?.url;
    if (typeof url === "string" && url.length > 0) return true;
  } catch {
    // fall through — treat as not sealed
  }
  try {
    const confirmation = await readSlotSidecar(stateDir, "confirmation");
    if (confirmation?.earlyDraftPrAt != null) return true;
  } catch {
    // fall through — treat as not sealed
  }
  return false;
}

const TRIGGER_LABELS: Record<string, string> = {
  review: "review follow-up",
  "ci-fix": "CI fix",
  "conflict-fix": "conflict fix",
};

/**
 * Derive the human-readable trigger label for a versioned revision from the
 * flow-machine snapshot persisted in the `flow` sidecar. Maps `review` →
 * "review follow-up", `ci-fix` → "CI fix", `conflict-fix` → "conflict fix";
 * any other / missing snapshot → "revision". Read failures resolve to
 * "revision". Never throws.
 */
export async function resolveTriggerLabel(stateDir: string): Promise<string> {
  try {
    const flow = await readSlotSidecar(stateDir, "flow");
    const snapshot = flow?.actorSnapshot as { value?: unknown } | undefined;
    const value = snapshot?.value;
    if (typeof value === "string" && TRIGGER_LABELS[value]) return TRIGGER_LABELS[value] as string;
  } catch {
    // fall through — default label
  }
  return "revision";
}

/** Build the title for a versioned revision attachment: `Ralph design #<n>
 *  (<label>)`, with ` (PDF)` appended for the `designPdf` slot. */
export function versionedTitle(slot: Slot, n: number, label: string): string {
  const base = `Ralph design #${n} (${label})`;
  return slot === "designPdf" ? `${base} (PDF)` : base;
}
