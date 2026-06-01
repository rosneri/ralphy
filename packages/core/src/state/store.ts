import { join } from "node:path";
import { OWNERSHIP } from "./schema";
import { writeSlotField } from "./sidecar";

export { readSlotSidecar, writeSlotField, slotSidecarPath } from "./sidecar";

export {
  readState,
  writeState,
  tryReadStateRaw,
  updateState,
  buildInitialState,
  ensureState,
  type BuildInitialStateOptions,
} from "../state";

const STATE_FILE = ".ralph-state.json";

/**
 * Thrown when a feature attempts to write outside its registered slot(s).
 * Carries the feature name + dotted path so callers can surface useful
 * diagnostics instead of a generic "permission denied".
 */
export class OwnershipError extends Error {
  public readonly featureName: string;
  public readonly path: string;
  constructor(featureName: string, path: string, message: string) {
    super(message);
    this.name = "OwnershipError";
    this.featureName = featureName;
    this.path = path;
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return {};
  try {
    const parsed: unknown = await file.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Write a single feature-owned field to its slot sidecar next to
 * `.ralph-state.json` in `changeDir`.
 *
 * `path` is a dotted slot path (e.g. `specAttachments.proposal`). The
 * top-level segment must appear in `OWNERSHIP[featureName]` or this
 * throws `OwnershipError` BEFORE touching disk.
 *
 * The write lands in `.ralph-state.<slot>.json`, NOT the shared
 * `.ralph-state.json`. Because each slot has exactly one owner, the sidecar
 * has exactly one writer and the cross-process lost-update that used to
 * truncate the shared file is impossible. See `./sidecar.ts` for the full
 * rationale. On the first write for a slot, any pre-existing inline value in
 * the core file is migrated into the sidecar so sibling fields are not lost.
 */
export async function writeField(
  changeDir: string,
  featureName: string,
  path: string,
  value: unknown,
): Promise<void> {
  const allowed = OWNERSHIP[featureName];
  if (!allowed) {
    throw new OwnershipError(
      featureName,
      path,
      `feature '${featureName}' is not registered in OWNERSHIP`,
    );
  }
  const topSlot = path.split(".")[0] as string;
  if (!allowed.includes(topSlot)) {
    throw new OwnershipError(
      featureName,
      path,
      `feature '${featureName}' may not write '${path}' (owns ${allowed.join(", ")})`,
    );
  }
  const inline = (await readJson(join(changeDir, STATE_FILE)))[topSlot];
  const seed =
    inline && typeof inline === "object" && !Array.isArray(inline)
      ? (inline as Record<string, unknown>)
      : undefined;
  await writeSlotField(changeDir, path, value, seed);
}
