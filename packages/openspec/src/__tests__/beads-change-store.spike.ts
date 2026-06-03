/**
 * THROWAWAY SPIKE — RLF-213.
 *
 * Prototype `BeadsChangeStore` read-path. This proves that `bd` (the beads
 * CLI) can sit behind the existing `ChangeStore` seam and reproduce the
 * markdown task-selection rules in `packages/core/src/tasks-md.ts`
 * (`firstUnchecked` + `pickActiveTasksFile`) without touching `loop.ts`,
 * `tasks-md.ts`, or the flow machine.
 *
 * It is **evaluation scope only**:
 *  - It is NOT exported from `packages/openspec/src/index.ts`.
 *  - It is NOT registered as the default `ChangeStore` anywhere.
 *  - It lives under `__tests__/` so it never ships in the published build.
 *  - The write/completion path is intentionally unimplemented (throws).
 *
 * Read-path mapping (verified in design.md "Backend evaluation"):
 *  - next task        → `bd ready --parent <epic> --exclude-type=epic --json`
 *  - remaining/done   → open-children count under the epic (NOT `ready`
 *                       emptiness, which is ambiguous under the embedded-Dolt
 *                       single-writer lock — see design.md concurrency finding)
 *  - flow preemption  → priority-0 beads that `blocks` mission work sort first
 *                       in `bd ready`, mirroring `agent-tasks.md` jumping the
 *                       queue ahead of `tasks.md`.
 */

import type {
  ArtifactInstructions,
  ArtifactStatus,
  ChangeDeltas,
  ChangeStatus,
  ChangeStore,
  ValidationResult,
} from "@ralphy/change-store";

/** Subset of a `bd` issue record (from `bd ready --json` / `bd list --json`). */
export interface BdIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  parent?: string;
  dependencies?: { issue_id: string; depends_on_id: string; type: string }[];
}

type RunResult = { status: number | null; stdout: string; stderr: string };

/** Priority value beads assigns to flow-grade work that preempts mission work. */
const FLOW_PRIORITY = 0;

/**
 * Render a `bd ready` result set into the markdown shape `buildTaskPrompt`
 * (via `firstUnchecked` + `pickActiveTasksFile`) expects.
 *
 * Flow-grade beads (priority 0) go in a `## Flow tasks` section that is
 * emitted *first*, so `firstUnchecked` selects them ahead of mission work —
 * exactly as `pickActiveTasksFile` prefers `agent-tasks.md` over `tasks.md`.
 * Within each section the original `bd ready` order is preserved (bd already
 * priority-sorts), so the first `- [ ]` line equals `bd ready --limit 1`.
 *
 * The bead id and priority are carried in an HTML comment so the (future)
 * completion path can map a ticked line back to `bd close <id>` without
 * polluting the visible task text the worker reads.
 */
export function renderReadyTasks(ready: BdIssue[]): string {
  const flow = ready.filter((i) => i.priority <= FLOW_PRIORITY);
  const mission = ready.filter((i) => i.priority > FLOW_PRIORITY);

  const line = (i: BdIssue) => `- [ ] ${i.title} <!-- bd:${i.id} p${i.priority} -->`;
  const sections: string[] = [];
  if (flow.length > 0) {
    sections.push(`## Flow tasks\n\n${flow.map(line).join("\n")}`);
  }
  if (mission.length > 0) {
    sections.push(`## Mission tasks\n\n${mission.map(line).join("\n")}`);
  }
  return sections.join("\n\n");
}

/**
 * Prototype `bd`-backed implementation of the read-path of `ChangeStore`.
 * Shells out via `Bun.spawnSync` (so tests can patch it the same way the
 * OpenSpec store tests do, rather than mocking `node:child_process`).
 */
export class BeadsChangeStore implements ChangeStore {
  /** Optional `-C <dir>` so a worktree worker can target main's `.beads/`. */
  private readonly cwd?: string;

  constructor(options: { cwd?: string } = {}) {
    if (options.cwd !== undefined) this.cwd = options.cwd;
  }

  private runBd(args: string[]): RunResult {
    const cmd = ["bd", ...(this.cwd ? ["-C", this.cwd] : []), ...args];
    const proc = Bun.spawnSync({ cmd, stdio: ["ignore", "pipe", "pipe"] });
    const decoder = new TextDecoder();
    return {
      status: proc.exitCode,
      stdout: proc.stdout ? decoder.decode(proc.stdout) : "",
      stderr: proc.stderr ? decoder.decode(proc.stderr) : "",
    };
  }

  /**
   * Run a `bd … --json` command and parse the JSON array result.
   *
   * Retries on *silent empty stdout* (exit 0, no output) — the embedded-Dolt
   * single-writer lock occasionally drops a result when many `bd` processes
   * contend (design.md concurrency finding). A literal `[]` is a real answer,
   * not a dropped one, so it does NOT retry. Throws when bd is unavailable so
   * callers never mistake "bd failed" for "no work".
   */
  private runBdJson(args: string[], retries = 3): BdIssue[] {
    let last: RunResult | null = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      last = this.runBd(args);
      if (last.status === null) {
        throw new Error("bd is not available (spawn failed)");
      }
      const out = last.stdout.trim();
      if (out !== "") {
        return JSON.parse(out) as BdIssue[];
      }
      // exit 0 + empty stdout → likely a lost-lock drop; retry.
    }
    throw new Error("bd returned empty output after retries (likely a lost-lock drop)", {
      cause: last?.stderr,
    });
  }

  /**
   * Resolve the epic bead that represents the change. Convention: an epic
   * titled `Change: <name>`. Returns null when no such epic exists.
   */
  private resolveEpicId(name: string): string | null {
    const issues = this.runBdJson(["list", "--status", "open", "--json"]);
    const epic = issues.find(
      (i) => i.issue_type === "epic" && (i.title === `Change: ${name}` || i.title === name),
    );
    return epic ? epic.id : null;
  }

  // --- read-path (the prototype's deliverable) ---------------------------

  async readTaskList(name: string): Promise<string> {
    const epicId = this.resolveEpicId(name);
    if (!epicId) return "";
    const ready = this.runBdJson(["ready", "--parent", epicId, "--exclude-type=epic", "--json"]);
    return renderReadyTasks(ready);
  }

  async getStatus(name: string): Promise<ChangeStatus> {
    const epicId = this.resolveEpicId(name);
    if (!epicId) {
      return { changeName: name, isComplete: false, applyRequires: [], artifacts: [] };
    }
    // Completion is decided by open-children count, NEVER by `bd ready`
    // emptiness — an empty `ready` can mean "all blocked" or "lost the lock
    // race", both of which would falsely read as "done".
    const openChildren = this.runBdJson([
      "list",
      "--status",
      "open",
      "--parent",
      epicId,
      "--exclude-type=epic",
      "--json",
    ]);
    const ready = this.runBdJson(["ready", "--parent", epicId, "--exclude-type=epic", "--json"]);
    const readyIds = new Set(ready.map((i) => i.id));
    const artifacts: ArtifactStatus[] = openChildren.map((child) => {
      const missingDeps = (child.dependencies ?? [])
        .filter((d) => d.type === "blocks")
        .map((d) => d.depends_on_id);
      const artifact: ArtifactStatus = {
        id: child.id,
        status: readyIds.has(child.id) ? "ready" : "blocked",
      };
      if (missingDeps.length > 0) artifact.missingDeps = missingDeps;
      return artifact;
    });
    return {
      changeName: name,
      isComplete: openChildren.length === 0,
      applyRequires: [],
      artifacts,
    };
  }

  async validateChange(name: string): Promise<ValidationResult> {
    let epicId: string | null;
    try {
      epicId = this.resolveEpicId(name);
    } catch (err) {
      return { valid: false, warnings: [], errors: [(err as Error).message] };
    }
    if (!epicId) {
      return {
        valid: false,
        warnings: [],
        errors: [`no bd epic titled "Change: ${name}"`],
      };
    }
    return { valid: true, warnings: [], errors: [] };
  }

  // --- write-path (out of spike scope) -----------------------------------

  private notImplemented(): Promise<never> {
    return Promise.reject(new Error("BeadsChangeStore spike: write-path not implemented"));
  }

  getChangeDirectory(name: string): string {
    // OpenSpec still owns proposal/design/specs; bd only backs tasks.
    return `openspec/changes/${name}`;
  }

  createChange(): Promise<void> {
    return this.notImplemented();
  }
  listChanges(): Promise<string[]> {
    return this.notImplemented();
  }
  writeTaskList(): Promise<void> {
    return this.notImplemented();
  }
  appendSteering(): Promise<void> {
    return this.notImplemented();
  }
  getInstructions(): Promise<ArtifactInstructions> {
    return this.notImplemented();
  }
  showChange(): Promise<ChangeDeltas> {
    return this.notImplemented();
  }
  archiveChange(): Promise<void> {
    return this.notImplemented();
  }
}
