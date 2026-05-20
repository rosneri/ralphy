import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { OWNERSHIP } from "./schema";

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

function deepSet(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i] as string;
    const existing = cursor[key];
    if (
      existing === undefined ||
      existing === null ||
      typeof existing !== "object" ||
      Array.isArray(existing)
    ) {
      const next: Record<string, unknown> = {};
      cursor[key] = next;
      cursor = next;
    } else {
      cursor = existing as Record<string, unknown>;
    }
  }
  cursor[segments[segments.length - 1] as string] = value;
}

/**
 * Write a single feature-owned field to `.ralph-state.json` in `changeDir`.
 *
 * `path` is a dotted slot path (e.g. `specAttachments.proposal`). The
 * top-level segment must appear in `OWNERSHIP[featureName]` or this
 * throws `OwnershipError` BEFORE touching disk. Unrelated slots are
 * preserved verbatim across the read-merge-write.
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
  const filePath = join(changeDir, STATE_FILE);
  const existing = await readJson(filePath);
  deepSet(existing, path, value);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(existing, null, 2) + "\n");
}
