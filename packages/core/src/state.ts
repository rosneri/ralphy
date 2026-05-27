import { join } from "node:path";
import { StateSchema, type State } from "@ralphy/types";
import { getStorage } from "@ralphy/context";
import { formatTaskName } from "./format";

const STATE_FILE = ".ralph-state.json";

/**
 * Read and parse .ralph-state.json from a change directory.
 */
export function readState(changeDir: string): State {
  const filePath = join(changeDir, STATE_FILE);
  const raw = getStorage().read(filePath);
  if (raw === null) throw new Error(".ralph-state.json not found");
  return StateSchema.parse(JSON.parse(raw));
}

/**
 * Attempt to read a valid state file. Returns null if the file does not
 * exist, is unreadable JSON, or fails schema validation. Use this when a
 * partial-write from an external writer (e.g. linear-sync) may have
 * produced a half-formed `.ralph-state.json` that the loop needs to
 * recover from rather than crash on.
 *
 * The raw parsed JSON (if any) is returned alongside so callers can salvage
 * non-schema fields like `linearComments`.
 */
export function tryReadStateRaw(changeDir: string): {
  state: State | null;
  raw: Record<string, unknown> | null;
} {
  const filePath = join(changeDir, STATE_FILE);
  const text = getStorage().read(filePath);
  if (text === null) return { state: null, raw: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: null, raw: null };
  }
  const raw = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const result = StateSchema.safeParse(parsed);
  return { state: result.success ? result.data : null, raw };
}

/**
 * Write .ralph-state.json to a change directory.
 */
export function writeState(changeDir: string, state: State): void {
  const filePath = join(changeDir, STATE_FILE);
  getStorage().write(filePath, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Read state, apply an updater function, and write back.
 */
export function updateState(changeDir: string, updater: (state: State) => State): State {
  const state = readState(changeDir);
  const updated = updater(state);
  writeState(changeDir, updated);
  return updated;
}

export interface BuildInitialStateOptions {
  name: string;
  prompt: string;
  engine?: string;
  model?: string;
  manualTest?: boolean;
  createPr?: boolean;
  prDraft?: boolean;
}

/**
 * Build a fresh State object with sensible defaults.
 */
export function buildInitialState(options: BuildInitialStateOptions): State {
  const now = new Date().toISOString();
  let branch = "main";
  try {
    const proc = Bun.spawnSync({
      cmd: ["git", "branch", "--show-current"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) {
      const out = new TextDecoder().decode(proc.stdout).trim();
      if (out) branch = out;
    }
  } catch {
    // not in a git repo — use default
  }

  return StateSchema.parse({
    version: "2",
    name: formatTaskName(options.name),
    prompt: options.prompt,
    engine: options.engine ?? "claude",
    model: options.model ?? "opus",
    manualTest: options.manualTest ?? false,
    createPr: options.createPr ?? false,
    prDraft: options.prDraft ?? false,
    createdAt: now,
    lastModified: now,
    metadata: { branch },
  });
}

/**
 * Ensure .ralph-state.json exists in a change directory. Idempotent.
 * If missing, initialises a fresh state.
 */
export function ensureState(changeDir: string): State {
  const filePath = join(changeDir, STATE_FILE);
  const storage = getStorage();
  if (storage.read(filePath) !== null) {
    return readState(changeDir);
  }

  const name = changeDir.split("/").pop() ?? "unknown";
  const state = buildInitialState({ name, prompt: "" });
  writeState(changeDir, state);
  return state;
}
