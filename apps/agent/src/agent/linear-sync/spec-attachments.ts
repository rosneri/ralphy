/**
 * Mirror `openspec/changes/<change>/proposal.md` and `design.md` into
 * Linear **attachments** on the parent issue. Attachment ids + content
 * hashes live in `.ralph-state.json` under `specAttachments` so the same
 * attachments are updated in place across iterations.
 *
 * On a hash match the slot is a no-op. On a hash miss the file is
 * re-uploaded and `attachmentUpdate(url:)` swings the existing
 * attachment to the new asset URL. If Linear reports the persisted
 * attachment id as missing (manual deletion) the slot is recreated.
 *
 * Each source file may produce up to two slots — the raw .md and, when
 * `specAttachmentFormats` includes "pdf", a pdfkit-rendered PDF mirror.
 * Both share the same source-file sha so the PDF skip-decision tracks
 * the markdown content directly.
 */

import { dirname, join } from "node:path";
import { writeField, readSlotSidecar } from "@ralphy/core/state";
import { isCommentNotFoundError } from "./comment-sync";
import { renderMarkdownToPdf } from "./render-pdf";
import { type LogFn, sha256Hex } from "./utils";

/** Build a Linear-API error suffix surfacing .status / .body / .messages from
 *  linearRequest; without it every HTTP failure collapses to the generic
 *  "Linear API request failed", hiding 4xx vs 5xx. */
function describeLinearError(err: unknown): string {
  const e = err as Error & { status?: number; body?: string; messages?: string[] };
  const parts: string[] = [e.message ?? String(err)];
  if (typeof e.status === "number") parts.push(`status=${e.status}`);
  if (Array.isArray(e.messages) && e.messages.length > 0)
    parts.push(`messages=${e.messages.join("; ")}`);
  if (typeof e.body === "string" && e.body.length > 0) {
    const trimmed = e.body.length > 200 ? `${e.body.slice(0, 200)}…` : e.body;
    parts.push(`body=${trimmed.replace(/\s+/g, " ").trim()}`);
  }
  return parts.join(" ");
}

export type AttachmentFormat = "md" | "pdf";

type Slot = "design" | "designPdf";
/** Legacy slot names retained only for purge-on-upgrade. Past versions
 *  uploaded proposal.md / proposal.pdf as their own attachments; we now
 *  publish only design (tasks.md embedded), so state carrying these slot
 *  ids must be cleared and the Linear attachments deleted on next sync. */
type LegacySlot = "proposal" | "proposalPdf";

interface SlotSpec {
  /** Source files (always .md) on disk to read, in order. The first file
   *  is required; subsequent files are appended to form the upload
   *  payload, separated by a markdown rule. Missing trailing files are
   *  skipped silently. */
  sourceFiles: string[];
  /** Filename to give Linear at upload time. */
  uploadFilename: string;
  /** MIME type Linear should record. */
  contentType: string;
  /** Attachment title (required by AttachmentUpdateInput). */
  title: string;
  /** Which format flag this slot belongs to. */
  format: AttachmentFormat;
  /** Transform the composed source bytes into the bytes to upload. md is
   *  identity; pdf renders via pdfkit. */
  renderBytes: (sourceBytes: Uint8Array) => Promise<Uint8Array>;
}

const identityRender = async (b: Uint8Array): Promise<Uint8Array> => b;
const pdfRender =
  (title: string) =>
  async (b: Uint8Array): Promise<Uint8Array> =>
    renderMarkdownToPdf(new TextDecoder().decode(b), title);

const SLOT_SPECS: Record<Slot, SlotSpec> = {
  design: {
    sourceFiles: ["design.md", "tasks.md"],
    uploadFilename: "design.md",
    contentType: "text/markdown",
    title: "Ralph design",
    format: "md",
    renderBytes: identityRender,
  },
  designPdf: {
    sourceFiles: ["design.md", "tasks.md"],
    uploadFilename: "design.pdf",
    contentType: "application/pdf",
    title: "Ralph design (PDF)",
    format: "pdf",
    renderBytes: pdfRender("Ralph design"),
  },
};

const LEGACY_SLOT_TITLES: Record<LegacySlot, string> = {
  proposal: "Ralph proposal",
  proposalPdf: "Ralph proposal (PDF)",
};

interface SpecAttachmentSlot {
  attachmentId: string | null;
  sha256: string | null;
}

/** One post-sealed design revision (v2+). Mirrors `RevisionSchema` in
 *  `@ralphy/types`; redeclared locally to keep this module dependency-light. */
interface Revision {
  version: number;
  attachmentId: string;
  sha256: string;
  trigger: string;
}

interface SpecAttachmentsState {
  design: SpecAttachmentSlot;
  designPdf: SpecAttachmentSlot;
  /** Carried only for purge-on-upgrade — never re-uploaded. */
  proposal: SpecAttachmentSlot;
  proposalPdf: SpecAttachmentSlot;
  /** Post-sealed revisions (v2+) for each design slot. `[]` when the
   *  change has not been sealed or has had no post-sealed content change. */
  designRevisions: Revision[];
  designPdfRevisions: Revision[];
}

/** Map a design slot to the `specAttachments.*Revisions` array that tracks
 *  its post-sealed versions. */
const REVISIONS_KEY: Record<Slot, "designRevisions" | "designPdfRevisions"> = {
  design: "designRevisions",
  designPdf: "designPdfRevisions",
};

export interface SpecAttachmentMutations {
  uploadFileToLinear: (
    apiKey: string,
    input: { filename: string; contentType: string; bytes: Uint8Array },
  ) => Promise<{ assetUrl: string }>;
  createAttachmentForUrl: (
    apiKey: string,
    input: { issueId: string; url: string; title: string; subtitle?: string },
  ) => Promise<string>;
  /** Linear's AttachmentUpdateInput has no `url` field — the only way to
   *  swing a Ralph attachment to new content is delete + create. */
  deleteAttachment: (apiKey: string, attachmentId: string) => Promise<void>;
  /** Look up an existing attachment on the issue by exact title match.
   *  Used to adopt a pre-existing Linear attachment when local state has
   *  been wiped — without this, the empty-cache path would create a
   *  duplicate every time the agent re-enters a change. */
  findIssueAttachmentByTitle: (
    apiKey: string,
    issueId: string,
    title: string,
  ) => Promise<string | null>;
}

interface SpecAttachmentsDeps {
  apiKey: string;
  issueId: string;
  /** Absolute path to `.ralph-state.json` for this change. */
  statePath: string;
  /** Absolute path to `openspec/changes/<name>` for this change. */
  changeDir: string;
  iteration: number;
  log: LogFn;
  /** File-only sink for recurring unchanged-skip lines; falls back to `log`. */
  fileLog?: LogFn;
  mutations: SpecAttachmentMutations;
  /** Formats to upload. Default ["md"]; add "pdf" for a pdfkit mirror keyed off the same source-md hash. */
  formats?: AttachmentFormat[];
  /** Post-seal behavior: "append" (default) publishes a new `#N` revision per design change; "replace" overwrites in place. */
  sealedRevisionMode?: "append" | "replace";
}

function logSkip(deps: SpecAttachmentsDeps, message: string): void {
  (deps.fileLog ?? deps.log)(message, "gray");
}

const EMPTY_SLOT: SpecAttachmentSlot = { attachmentId: null, sha256: null };

function stateDirOf(statePath: string): string {
  return dirname(statePath);
}

async function readInlineSpecAttachments(statePath: string): Promise<Record<string, unknown>> {
  const file = Bun.file(statePath);
  if (!(await file.exists())) return {};
  try {
    const parsed: unknown = await file.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const sa = (parsed as Record<string, unknown>).specAttachments;
      return sa && typeof sa === "object" && !Array.isArray(sa)
        ? (sa as Record<string, unknown>)
        : {};
    }
    return {};
  } catch {
    return {};
  }
}

/** Read the `specAttachments` slot subtree. Authoritative copy is the
 *  `.ralph-state.specAttachments.json` sidecar (single-writer); falls back to
 *  the inline core-file slot for changes written before the sidecar split. */
async function readSpecAttachmentsSubtree(statePath: string): Promise<Record<string, unknown>> {
  const sidecar = await readSlotSidecar(dirname(statePath), "specAttachments");
  return sidecar ?? (await readInlineSpecAttachments(statePath));
}

/** Coerce an unknown sidecar value into a Revision[]; drops malformed
 *  entries so a corrupt slot degrades to "no revisions" rather than throwing. */
function asRevisions(value: unknown): Revision[] {
  if (!Array.isArray(value)) return [];
  const out: Revision[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>;
      if (
        typeof e.version === "number" &&
        typeof e.attachmentId === "string" &&
        typeof e.sha256 === "string" &&
        typeof e.trigger === "string"
      ) {
        out.push({
          version: e.version,
          attachmentId: e.attachmentId,
          sha256: e.sha256,
          trigger: e.trigger,
        });
      }
    }
  }
  return out;
}

async function readSpecAttachments(statePath: string): Promise<SpecAttachmentsState> {
  const sa = (await readSpecAttachmentsSubtree(statePath)) as Partial<
    Record<Slot | LegacySlot, Partial<SpecAttachmentSlot>>
  > & { designRevisions?: unknown; designPdfRevisions?: unknown };
  return {
    proposal: {
      attachmentId: sa.proposal?.attachmentId ?? null,
      sha256: sa.proposal?.sha256 ?? null,
    },
    design: {
      attachmentId: sa.design?.attachmentId ?? null,
      sha256: sa.design?.sha256 ?? null,
    },
    proposalPdf: {
      attachmentId: sa.proposalPdf?.attachmentId ?? null,
      sha256: sa.proposalPdf?.sha256 ?? null,
    },
    designPdf: {
      attachmentId: sa.designPdf?.attachmentId ?? null,
      sha256: sa.designPdf?.sha256 ?? null,
    },
    designRevisions: asRevisions(sa.designRevisions),
    designPdfRevisions: asRevisions(sa.designPdfRevisions),
  };
}

async function persistSlot(
  statePath: string,
  slot: Slot | LegacySlot,
  value: SpecAttachmentSlot,
): Promise<void> {
  await writeField(stateDirOf(statePath), "linear-attachments", `specAttachments.${slot}`, value);
}

async function persistRevision(
  statePath: string,
  slot: Slot,
  revisions: Revision[],
): Promise<void> {
  await writeField(
    stateDirOf(statePath),
    "linear-attachments",
    `specAttachments.${REVISIONS_KEY[slot]}`,
    revisions,
  );
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

/**
 * Adopt a pre-existing Linear attachment matching `slot`'s title. Used
 * when local state is empty (fresh worktree or wiped `.ralph-state.json`)
 * to prevent creating a duplicate. Failures are logged yellow and the
 * caller proceeds as if no match exists.
 */
async function adopt(deps: SpecAttachmentsDeps, slot: Slot): Promise<{ adoptedId: string | null }> {
  const spec = SLOT_SPECS[slot];
  try {
    const adoptedId = await deps.mutations.findIssueAttachmentByTitle(
      deps.apiKey,
      deps.issueId,
      spec.title,
    );
    if (adoptedId) {
      await persistSlot(deps.statePath, slot, { attachmentId: adoptedId, sha256: null });
      deps.log(
        `  spec-attachments: adopted existing ${spec.uploadFilename} attachment ${adoptedId}`,
        "gray",
      );
      return { adoptedId };
    }
    return { adoptedId: null };
  } catch (err) {
    deps.log(
      `! spec-attachments: findIssueAttachmentByTitle ${spec.uploadFilename} failed (treating as no match): ${describeLinearError(err)}`,
      "yellow",
    );
    return { adoptedId: null };
  }
}

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

/**
 * Sealed (post-PR) path for one design slot in **append** mode. The v1
 * attachment and any prior revisions are **never** deleted. A changed design
 * publishes a new additional attachment titled `Ralph design #<n> (<label>)`:
 *
 *   1. Skip (no network) if `hash` equals the v1 slot sha256 or any recorded
 *      revision sha256 — re-syncing identical content is a no-op.
 *   2. Otherwise compute `n = 2 + revisions.length`, derive the trigger
 *      label, render + upload the bytes, **adopt-or-create** the versioned
 *      title (look up first; on miss create), and append the revision.
 *
 * `hash` is the **design-only** hash (sha256 of `design.md` alone), so a
 * checkbox-only tick of the `tasks.md` Implementation checklist — which leaves
 * `design.md` unchanged — yields the same hash as the last revision and is a
 * no-op. The uploaded bytes still render from the **composed** `sourceBytes`
 * (design.md + tasks.md Implementation), so published content is unchanged;
 * only the change-detection key narrows. The persisted revision records the
 * design-only `hash`.
 */
async function syncSlotSealed(
  deps: SpecAttachmentsDeps,
  slot: Slot,
  sourceBytes: Uint8Array,
  hash: string,
  state: SpecAttachmentsState,
): Promise<void> {
  const spec = SLOT_SPECS[slot];
  const revisions = state[REVISIONS_KEY[slot]];
  const v1Sha = state[slot]?.sha256 ?? null;

  // Idempotent: identical bytes to v1 or any published revision → no-op.
  if (hash === v1Sha || revisions.some((r) => r.sha256 === hash)) {
    logSkip(deps, `  spec-attachments: ${spec.uploadFilename} unchanged (sealed), skipping`);
    return;
  }

  const n = 2 + revisions.length;
  const label = await resolveTriggerLabel(stateDirOf(deps.statePath));
  const title = versionedTitle(slot, n, label);

  let uploadBytes: Uint8Array;
  try {
    uploadBytes = await spec.renderBytes(sourceBytes);
  } catch (err) {
    deps.log(
      `! spec-attachments: render ${spec.uploadFilename} (sealed) failed: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }

  let assetUrl: string;
  try {
    const uploaded = await deps.mutations.uploadFileToLinear(deps.apiKey, {
      filename: spec.uploadFilename,
      contentType: spec.contentType,
      bytes: uploadBytes,
    });
    assetUrl = uploaded.assetUrl;
  } catch (err) {
    deps.log(
      `! spec-attachments: upload ${spec.uploadFilename} (sealed) failed: ${describeLinearError(err)}`,
      "yellow",
    );
    return;
  }

  // Adopt-or-create: if an attachment with this exact versioned title
  // already exists (e.g. state was wiped but the attachment survived),
  // adopt its id rather than creating a duplicate. Lookup failure falls
  // through to create (mirrors the v1 adopt() resilience).
  let attachmentId: string | null = null;
  try {
    attachmentId = await deps.mutations.findIssueAttachmentByTitle(
      deps.apiKey,
      deps.issueId,
      title,
    );
    if (attachmentId) {
      deps.log(`  spec-attachments: adopted existing ${title} attachment ${attachmentId}`, "gray");
    }
  } catch (err) {
    deps.log(
      `! spec-attachments: findIssueAttachmentByTitle ${title} failed (treating as no match): ${describeLinearError(err)}`,
      "yellow",
    );
    attachmentId = null;
  }

  if (!attachmentId) {
    try {
      attachmentId = await deps.mutations.createAttachmentForUrl(deps.apiKey, {
        issueId: deps.issueId,
        url: assetUrl,
        title,
        subtitle: `iteration ${deps.iteration}`,
      });
    } catch (err) {
      deps.log(
        `! spec-attachments: createAttachmentForUrl ${title} failed: ${describeLinearError(err)}`,
        "yellow",
      );
      return;
    }
    deps.log(`  spec-attachments: created ${title} attachment`, "gray");
  }

  await persistRevision(deps.statePath, slot, [
    ...revisions,
    { version: n, attachmentId, sha256: hash, trigger: label },
  ]);
}

/** The composed spec source both sinks publish (attachment slots and the
 *  comment-embedded SpecSink). */
interface ComposedSpecSource {
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

async function syncSlot(deps: SpecAttachmentsDeps, slot: Slot): Promise<void> {
  const spec = SLOT_SPECS[slot];
  const source = await composeSpecSource(deps.changeDir, deps.log, spec.sourceFiles);
  if (!source) return;
  const { sourceBytes, hash, designOnlyHash } = source;
  const state = await readSpecAttachments(deps.statePath);

  const sealed = await isDesignSealed(stateDirOf(deps.statePath));
  const mode = deps.sealedRevisionMode ?? "append";

  // Once the change is sealed (a PR exists) in append mode, publish a changed
  // design as a new versioned attachment instead of overwriting v1 in place.
  // Pre-seal — and sealed+replace — fall through to the in-place path below.
  if (sealed && mode === "append") {
    await syncSlotSealed(deps, slot, sourceBytes, designOnlyHash, state);
    return;
  }

  // Skip/persist hash: pre-seal compares the composed hash (so task edits
  // still refresh the attachment before a PR exists); sealed+replace compares
  // the design-only hash (so checkbox ticks don't churn the attachment).
  const skipHash = sealed ? designOnlyHash : hash;

  let current = state[slot] ?? EMPTY_SLOT;

  // Empty cache: ask Linear whether an attachment with this slot's title
  // already exists on the issue. Adopting it prevents a duplicate when
  // .ralph-state.json is wiped or the worktree is re-scaffolded.
  if (!current.attachmentId) {
    const { adoptedId } = await adopt(deps, slot);
    if (adoptedId) {
      current = { attachmentId: adoptedId, sha256: null };
    }
  }

  if (current.attachmentId && current.sha256 === skipHash) {
    logSkip(deps, `  spec-attachments: ${spec.uploadFilename} unchanged, skipping`);
    return;
  }

  let uploadBytes: Uint8Array;
  try {
    uploadBytes = await spec.renderBytes(sourceBytes);
  } catch (err) {
    deps.log(
      `! spec-attachments: render ${spec.uploadFilename} failed: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }

  const subtitle = `iteration ${deps.iteration}`;

  let assetUrl: string;
  try {
    const uploaded = await deps.mutations.uploadFileToLinear(deps.apiKey, {
      filename: spec.uploadFilename,
      contentType: spec.contentType,
      bytes: uploadBytes,
    });
    assetUrl = uploaded.assetUrl;
  } catch (err) {
    deps.log(
      `! spec-attachments: upload ${spec.uploadFilename} failed: ${describeLinearError(err)}`,
      "yellow",
    );
    return;
  }

  if (current.attachmentId) {
    // Linear's attachmentUpdate has no `url` field, so refresh = delete +
    // create. A failed delete is non-fatal (most often the attachment was
    // already removed manually) — we still create the replacement.
    try {
      await deps.mutations.deleteAttachment(deps.apiKey, current.attachmentId);
      deps.log(
        `  spec-attachments: deleted stale ${spec.uploadFilename} attachment ${current.attachmentId}`,
        "gray",
      );
    } catch (err) {
      if (isCommentNotFoundError(err)) {
        deps.log(
          `  spec-attachments: attachment ${current.attachmentId} already gone — recreating`,
          "gray",
        );
      } else {
        deps.log(
          `! spec-attachments: deleteAttachment ${spec.uploadFilename} failed (continuing): ${describeLinearError(err)}`,
          "yellow",
        );
      }
    }
  }

  let newId: string;
  try {
    newId = await deps.mutations.createAttachmentForUrl(deps.apiKey, {
      issueId: deps.issueId,
      url: assetUrl,
      title: spec.title,
      subtitle,
    });
  } catch (err) {
    deps.log(
      `! spec-attachments: createAttachmentForUrl ${spec.uploadFilename} failed: ${describeLinearError(err)}`,
      "yellow",
    );
    return;
  }
  await persistSlot(deps.statePath, slot, { attachmentId: newId, sha256: skipHash });
  deps.log(`  spec-attachments: created ${spec.uploadFilename} attachment`, "gray");
}

/** Delete any pre-existing proposal / proposalPdf attachments left over
 *  from before we consolidated everything into the design slot. Runs once
 *  per change: persists `legacyProposalPurged: true` in state so the
 *  Linear lookup is not repeated every sync. */
async function purgeLegacyProposalSlots(deps: SpecAttachmentsDeps): Promise<void> {
  const sa = await readSpecAttachmentsSubtree(deps.statePath);
  if (sa.legacyProposalPurged === true) return;
  const state = await readSpecAttachments(deps.statePath);
  for (const slot of ["proposal", "proposalPdf"] as LegacySlot[]) {
    const recordedId = state[slot]?.attachmentId ?? null;
    let idToDelete = recordedId;
    if (!idToDelete) {
      try {
        idToDelete = await deps.mutations.findIssueAttachmentByTitle(
          deps.apiKey,
          deps.issueId,
          LEGACY_SLOT_TITLES[slot],
        );
      } catch (err) {
        deps.log(
          `! spec-attachments: legacy lookup for ${LEGACY_SLOT_TITLES[slot]} failed (skipping): ${describeLinearError(err)}`,
          "yellow",
        );
        idToDelete = null;
      }
    }
    if (!idToDelete) continue;
    try {
      await deps.mutations.deleteAttachment(deps.apiKey, idToDelete);
      deps.log(
        `  spec-attachments: removed legacy ${LEGACY_SLOT_TITLES[slot]} attachment ${idToDelete}`,
        "gray",
      );
    } catch (err) {
      if (isCommentNotFoundError(err)) {
        deps.log(
          `  spec-attachments: legacy ${LEGACY_SLOT_TITLES[slot]} attachment already gone`,
          "gray",
        );
      } else {
        deps.log(
          `! spec-attachments: delete legacy ${LEGACY_SLOT_TITLES[slot]} failed (continuing): ${describeLinearError(err)}`,
          "yellow",
        );
      }
    }
    if (recordedId) {
      await persistSlot(deps.statePath, slot, EMPTY_SLOT);
    }
  }
  await writeField(
    stateDirOf(deps.statePath),
    "linear-attachments",
    "specAttachments.legacyProposalPurged",
    true,
  );
}

/** Sync the design attachment (design.md with tasks.md appended) and,
 *  optionally, its pdfkit-rendered PDF mirror, to Linear. Any pre-existing
 *  proposal attachments from before this slot consolidation are deleted
 *  on first run. Slots are independent — a missing or failing slot does
 *  not affect the others. */
export async function syncSpecAttachments(deps: SpecAttachmentsDeps): Promise<void> {
  await purgeLegacyProposalSlots(deps);
  const enabled = new Set<AttachmentFormat>(deps.formats ?? ["md"]);
  const order: Slot[] = ["design", "designPdf"];
  for (const slot of order) {
    if (!enabled.has(SLOT_SPECS[slot].format)) continue;
    await syncSlot(deps, slot);
  }
}
