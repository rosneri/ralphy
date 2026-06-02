import { dirname, join } from "node:path";
import { mkdir, rename, unlink } from "node:fs/promises";
import { ALL_OWNED_SLOTS } from "./schema";

/**
 * Per-slot sidecar files for `.ralph-state.json`.
 *
 * ## Why this exists
 *
 * `.ralph-state.json` was written by four uncoordinated whole-file
 * read-modify-write paths spread across two processes (the loop subprocess
 * and the agent main process):
 *
 *   1. loop `writeState` / `updateState`     — core fields
 *   2. `writeField`                          — specAttachments / review / ci / pr / flow
 *   3. `writeConfirmationState`              — confirmation
 *   4. comment-sync `patchComments`          — linearComments
 *
 * Each one read the whole file, mutated one slot, and wrote the whole file
 * back. With two processes racing, the last writer wins and silently drops
 * every field it had not read — the classic lost-update. In production this
 * truncated `.ralph-state.json` down to a single 64-byte
 * `{ "specAttachments": { "legacyProposalPurged": true } }`, erasing the
 * loop's iteration / status / confirmation state for five LIT changes.
 *
 * ## The fix
 *
 * Each *owned* top-level slot (see `OWNERSHIP` / `ALL_OWNED_SLOTS`) lives in
 * its own sidecar file, `.ralph-state.<slot>.json`, holding that slot's
 * subtree verbatim. One slot ⇒ one file ⇒ one writer, so no two writers ever
 * touch the same file and the lost-update is impossible by construction. The
 * core `.ralph-state.json` keeps only the loop-owned fields.
 *
 * Reads compose the picture back together: the core file provides the
 * loop-owned fields and every present sidecar overlays its slot (sidecar
 * always wins over any stale inline copy left in the core file).
 *
 * Writes are atomic (temp file + POSIX rename) so a concurrent reader always
 * sees a complete file, never a truncated one.
 */

const CORE_STATE_FILE = ".ralph-state.json";

/** Absolute path of the sidecar file backing `slot` in `changeDir`. */
export function slotSidecarPath(changeDir: string, slot: string): string {
  return join(changeDir, `${CORE_STATE_FILE.replace(/\.json$/, "")}.${slot}.json`);
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Set `value` at a dotted `path` within `target`, creating intermediate
 *  objects as needed. An empty path replaces the whole object's contents. */
function deepSet(target: Record<string, unknown>, path: string, value: unknown): void {
  if (path === "") {
    for (const k of Object.keys(target)) delete target[k];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(target, value as Record<string, unknown>);
    }
    return;
  }
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i] as string;
    const existing = cursor[key];
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      const next: Record<string, unknown> = {};
      cursor[key] = next;
      cursor = next;
    } else {
      cursor = existing as Record<string, unknown>;
    }
  }
  cursor[segments[segments.length - 1] as string] = value;
}

/** Atomic write: stage to a sibling temp file then rename over the target.
 *  POSIX rename is atomic, so a concurrent reader sees old-or-new, never a
 *  half-written file. */
let writeSeq = 0;
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${writeSeq++}`;
  try {
    await Bun.write(tmp, content);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Read one slot's subtree from its sidecar (async, raw IO — usable in the
 *  agent main process which has no storage context). Returns `undefined`
 *  when the sidecar does not exist. */
export async function readSlotSidecar(
  changeDir: string,
  slot: string,
): Promise<Record<string, unknown> | undefined> {
  const file = Bun.file(slotSidecarPath(changeDir, slot));
  if (!(await file.exists())) return undefined;
  const obj = parseObject(await file.text().catch(() => null));
  return obj ?? undefined;
}

/**
 * Write a dotted slot path to its sidecar. `path` is the full dotted path as
 * passed to `writeField` (e.g. `specAttachments.design`); the leading slot
 * segment selects the sidecar and the remainder addresses within it.
 *
 * `seedInline` is the slot's pre-existing inline value from the core
 * `.ralph-state.json` (if any). It is used **only** when the sidecar does not
 * yet exist, so a one-time migration off the old inline layout preserves
 * sibling fields (e.g. `specAttachments.legacyProposalPurged`) instead of
 * dropping them on the first sidecar write.
 */
export async function writeSlotField(
  changeDir: string,
  path: string,
  value: unknown,
  seedInline?: Record<string, unknown>,
): Promise<void> {
  const [slot, ...rest] = path.split(".");
  const sidecarPath = slotSidecarPath(changeDir, slot as string);
  const existing = parseObject(
    await Bun.file(sidecarPath)
      .text()
      .catch(() => null),
  );
  const obj: Record<string, unknown> = existing ?? (seedInline ? structuredClone(seedInline) : {});
  deepSet(obj, rest.join("."), value);
  await atomicWrite(sidecarPath, JSON.stringify(obj, null, 2) + "\n");
}

/** Overlay every present slot sidecar onto `target`, mutating it in place and
 *  returning it. The sidecar always wins over any stale inline copy. `read`
 *  is a synchronous file reader (typically `getStorage().read`) so this can
 *  run inside the loop's synchronous `readState`. */
export function overlaySidecarsSync(
  changeDir: string,
  target: Record<string, unknown>,
  read: (path: string) => string | null,
): Record<string, unknown> {
  for (const slot of ALL_OWNED_SLOTS) {
    const obj = parseObject(read(slotSidecarPath(changeDir, slot)));
    if (obj !== undefined && obj !== null) target[slot] = obj;
  }
  return target;
}
