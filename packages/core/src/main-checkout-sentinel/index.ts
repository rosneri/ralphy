/**
 * Main-checkout sentinel (RLF-224).
 *
 * Detects — and never repairs — a worker run that dirties the developer's main
 * checkout (`projectRoot`). Ralphy spawns each engine with `cwd` set to an
 * isolated worktree, but it cannot police every file op that engine or the
 * target project's own scripts/hooks perform. The enforceable contract is
 * narrow: the main checkout must look exactly as dirty after a worker run as it
 * did before; if not, shout.
 *
 * The main working tree may hold the developer's own uncommitted work, so the
 * only safe action is to report — this module never runs `git restore`/`reset`.
 */

/**
 * Minimal structural twin of the `GitRunner` in `apps/agent/src/agent/worktree.ts`.
 * Defined locally (and under a distinct name) so `@ralphy/core` carries no
 * back-import from the app (project rule: write code in packages, consume from
 * apps) and so the two declarations don't collide in the duplicate-name gate.
 * The app's `GitRunner` is structurally compatible and passes straight in.
 * Named for its narrow use here — it only runs `rev-parse`/`status`.
 */
export interface GitStatusRunner {
  /** Run a git command in the given cwd. Throws on non-zero exit. */
  run: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
}

export interface CheckoutSnapshot {
  /** HEAD sha of `root`, or "" if it could not be read. */
  head: string;
  /** `git status --porcelain` lines (trimmed, sorted), or [] on failure. */
  entries: string[];
}

export interface CheckoutLeak {
  leaked: boolean;
  headMoved: boolean;
  /** porcelain entries present in `after` but not `before`. */
  newEntries: string[];
}

/** True when the snapshot is the degraded "could not determine" sentinel. */
function isEmptySentinel(s: CheckoutSnapshot): boolean {
  return s.head === "" && s.entries.length === 0;
}

/**
 * Capture HEAD + working-tree dirtiness of `root` via the injected runner.
 *
 * Any thrown git error (transient `index.lock`, not-a-repo in odd setups) is
 * swallowed and the result degrades to the empty sentinel (`head: ""`,
 * `entries: []`). Rationale: a diagnostic must never abort a worker.
 */
export async function snapshotCheckout(
  root: string,
  runner: GitStatusRunner,
): Promise<CheckoutSnapshot> {
  try {
    const head = await runner.run(["rev-parse", "HEAD"], root);
    const status = await runner.run(["status", "--porcelain"], root);
    const entries = status.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort();
    return { head: head.stdout.trim(), entries };
  } catch {
    return { head: "", entries: [] };
  }
}

/**
 * Pure set-diff + HEAD comparison over two snapshots.
 *
 * - `newEntries` = `after.entries` minus `before.entries` (so a developer's
 *   pre-existing dirty files never count).
 * - `headMoved` = both heads non-empty and unequal.
 * - `leaked` = any new entry OR head moved.
 *
 * If either snapshot is the empty sentinel, treats it as "could not determine"
 * and returns `leaked: false` (fail open — never raise a false alarm off a git
 * failure).
 */
export function detectCheckoutLeak(
  before: CheckoutSnapshot,
  after: CheckoutSnapshot,
): CheckoutLeak {
  if (isEmptySentinel(before) || isEmptySentinel(after)) {
    return { leaked: false, headMoved: false, newEntries: [] };
  }
  const beforeSet = new Set(before.entries);
  const newEntries = after.entries.filter((e) => !beforeSet.has(e));
  const headMoved = before.head !== "" && after.head !== "" && before.head !== after.head;
  return { leaked: newEntries.length > 0 || headMoved, headMoved, newEntries };
}
