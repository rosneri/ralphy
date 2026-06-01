/**
 * Mirror tasks.md, the final plan, and steering nudges into Linear
 * **comments** (rather than the issue description). The persistent
 * comment ids live in `.ralph-state.json` so the same comments are
 * updated / deleted in place across iterations and process restarts.
 *
 * Three orchestrators:
 *   - postOrUpdateTasksComment    — sticky "📝 Tasks" comment
 *   - postPlanCommentOnce         — one-shot "📋 Plan" comment
 *   - postSteeringAndRefreshTasks — fresh "🧭 Steering" comment, then
 *                                    delete + re-post tasks comment so it
 *                                    always lands at the bottom.
 */

import { dirname, join } from "node:path";
import { readSlotSidecar, writeSlotField } from "@ralphy/core/state";
import { renderTasksBlock } from "./index";
import { type LogFn, sha256Hex } from "./utils";

const PLAN_COMMENT_TITLE = "📋 Ralph plan";
const STEERING_COMMENT_TITLE = "🧭 Ralph steering";

interface LinearCommentsState {
  planCommentId: string | null;
  tasksCommentId: string | null;
  planPostedAt: string | null;
  tasksCommentSha256: string | null;
}

interface PersistedState {
  linearComments?: Partial<LinearCommentsState> | null;
  [key: string]: unknown;
}

export interface CommentMutations {
  createIssueComment: (apiKey: string, issueId: string, body: string) => Promise<string>;
  updateIssueComment: (apiKey: string, commentId: string, body: string) => Promise<void>;
  deleteIssueComment: (apiKey: string, commentId: string) => Promise<void>;
}

interface BaseDeps {
  apiKey: string;
  issueId: string;
  /** Absolute path to `.ralph-state.json` for this change. */
  statePath: string;
  /** Absolute path to `openspec/changes/<name>` for this change. */
  changeDir: string;
  changeName: string;
  log: LogFn;
  mutations: CommentMutations;
}

interface TasksCommentDeps extends BaseDeps {
  iteration: number;
}

interface SteeringDeps extends BaseDeps {
  iteration: number;
  message: string;
}

/** Read the inline `linearComments` slot from the legacy core
 *  `.ralph-state.json` — used once to migrate a change written before the
 *  slot moved to its own sidecar. */
async function readInlineLinearComments(
  statePath: string,
): Promise<Partial<LinearCommentsState> | undefined> {
  const file = Bun.file(statePath);
  if (!(await file.exists())) return undefined;
  try {
    const obj = (await file.json()) as PersistedState;
    return (obj.linearComments ?? undefined) as Partial<LinearCommentsState> | undefined;
  } catch {
    return undefined;
  }
}

/** Read the linearComments slot. Authoritative copy lives in the
 *  `.ralph-state.linearComments.json` sidecar (single-writer, clobber-free);
 *  falls back to the inline core-file slot for pre-sidecar changes. */
async function readComments(statePath: string): Promise<LinearCommentsState> {
  const changeDir = dirname(statePath);
  const raw =
    (await readSlotSidecar(changeDir, "linearComments")) ??
    (await readInlineLinearComments(statePath)) ??
    {};
  const r = raw as Partial<LinearCommentsState>;
  return {
    planCommentId: r.planCommentId ?? null,
    tasksCommentId: r.tasksCommentId ?? null,
    planPostedAt: r.planPostedAt ?? null,
    tasksCommentSha256: r.tasksCommentSha256 ?? null,
  };
}

/** Patch the linearComments slot in its sidecar. The whole slot is written
 *  atomically; the core `.ralph-state.json` is never touched. */
async function patchComments(
  statePath: string,
  patch: Partial<LinearCommentsState>,
): Promise<void> {
  const current = await readComments(statePath);
  const next: LinearCommentsState = { ...current, ...patch };
  await writeSlotField(dirname(statePath), "linearComments", next);
}

/** Linear surfaces "entity not found" / "not found" via the
 *  errors[].message channel that `linearRequest` packages onto an
 *  Error.messages array. Be permissive — different Linear API revisions
 *  use slightly different wording. */
export function isCommentNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const candidates: string[] = [];
  const e = err as Error & { messages?: string[]; message?: string };
  if (Array.isArray(e.messages)) candidates.push(...e.messages);
  if (typeof e.message === "string") candidates.push(e.message);
  const text = candidates.join(" ").toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("could not find") ||
    text.includes("entity not found")
  );
}

async function readTasksMd(changeDir: string, log: LogFn): Promise<string | null> {
  const file = Bun.file(join(changeDir, "tasks.md"));
  if (!(await file.exists())) {
    log(`  comment-sync: tasks.md missing in ${changeDir}, skipping`, "gray");
    return null;
  }
  try {
    return await file.text();
  } catch (err) {
    log(`! comment-sync: read tasks.md failed: ${(err as Error).message}`, "yellow");
    return null;
  }
}

function renderTasksCommentBody(tasksMd: string, changeName: string, iteration: number): string {
  return renderTasksBlock(tasksMd, { changeName, iteration });
}

/**
 * Sticky tasks comment. Creates it on first call (persists the new id);
 * updates it in place on subsequent calls. If Linear reports the comment
 * as missing (manual deletion), falls back to creating a fresh one and
 * persists the replacement id. Returns the comment id on success.
 */
export async function postOrUpdateTasksComment(deps: TasksCommentDeps): Promise<string | null> {
  const tasksMd = await readTasksMd(deps.changeDir, deps.log);
  if (!tasksMd) return null;
  const body = renderTasksCommentBody(tasksMd, deps.changeName, deps.iteration);
  const hash = sha256Hex(tasksMd);

  const comments = await readComments(deps.statePath);

  if (comments.tasksCommentId) {
    if (comments.tasksCommentSha256 === hash) {
      deps.log(`  comment-sync: tasks.md unchanged for ${deps.changeName}, skipping`, "gray");
      return comments.tasksCommentId;
    }
    try {
      await deps.mutations.updateIssueComment(deps.apiKey, comments.tasksCommentId, body);
      await patchComments(deps.statePath, { tasksCommentSha256: hash });
      deps.log(`  comment-sync: updated tasks comment for ${deps.changeName}`, "gray");
      return comments.tasksCommentId;
    } catch (err) {
      if (!isCommentNotFoundError(err)) {
        deps.log(`! comment-sync: updateIssueComment failed: ${(err as Error).message}`, "yellow");
        return null;
      }
      deps.log(
        `  comment-sync: tasks comment ${comments.tasksCommentId} not found — recreating`,
        "gray",
      );
      // Fall through to create-fresh below.
    }
  }

  let newId: string;
  try {
    newId = await deps.mutations.createIssueComment(deps.apiKey, deps.issueId, body);
  } catch (err) {
    deps.log(`! comment-sync: createIssueComment failed: ${(err as Error).message}`, "yellow");
    return null;
  }
  await patchComments(deps.statePath, { tasksCommentId: newId, tasksCommentSha256: hash });
  deps.log(`  comment-sync: created tasks comment for ${deps.changeName}`, "gray");
  return newId;
}

interface SectionCheck {
  /** True when the named section is present AND every checkbox in it is checked. */
  allChecked: boolean;
  /** Number of bullet checkboxes seen in the section. */
  total: number;
}

/** Parse tasks.md and return structured info about the `## Planning` section.
 *  `allChecked` is true only when the section exists and all items are checked
 *  (false when the section is absent or has unchecked items). */
export function parsePlanningSection(tasksMd: string): SectionCheck {
  const lines = tasksMd.split(/\r?\n/);
  let inPlanning = false;
  let total = 0;
  let unchecked = 0;
  for (const line of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      inPlanning = h[1]!.trim().toLowerCase() === "planning";
      continue;
    }
    if (!inPlanning) continue;
    const m = /^\s*-\s+\[( |x|X)\]/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] === " ") unchecked += 1;
  }
  return { allChecked: total > 0 && unchecked === 0, total };
}

async function readFirstParagraph(path: string): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  // Skip leading H1 / blank lines, then take the first non-empty paragraph.
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !/^#\s/.test(b));
  return blocks[0] ?? null;
}

async function readSection(path: string, heading: string): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  const headingRe = new RegExp(`(^|\\n)##\\s+${heading}\\s*\\n`);
  const m = headingRe.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = /\n##\s+/.exec(rest);
  const body = next ? rest.slice(0, next.index) : rest;
  return body.trim() || null;
}

/**
 * One-shot plan comment. Skips when planning isn't yet complete, when
 * the plan comment id is already persisted, or when proposal.md is
 * missing. Persists the new comment id + planPostedAt on success.
 */
export async function postPlanCommentOnce(deps: BaseDeps): Promise<string | null> {
  const comments = await readComments(deps.statePath);
  if (comments.planCommentId) return null;

  const tasksMd = await readTasksMd(deps.changeDir, deps.log);
  if (!tasksMd) return null;
  const check = parsePlanningSection(tasksMd);
  if (!check.allChecked) return null;

  const proposalPath = join(deps.changeDir, "proposal.md");
  const why = await readSection(proposalPath, "Why");
  const whatChanges = await readSection(proposalPath, "What Changes");
  if (!why && !whatChanges) {
    deps.log(`  comment-sync: proposal.md has no Why/What Changes, skipping plan comment`, "gray");
    return null;
  }

  const designSummary = await readFirstParagraph(join(deps.changeDir, "design.md"));

  const parts: string[] = [`### ${PLAN_COMMENT_TITLE} — \`${deps.changeName}\``];
  if (why) {
    parts.push("", "**Why**", "", why);
  }
  if (whatChanges) {
    parts.push("", "**What Changes**", "", whatChanges);
  }
  if (designSummary) {
    parts.push("", "**Design**", "", designSummary);
  }
  const body = parts.join("\n");

  let id: string;
  try {
    id = await deps.mutations.createIssueComment(deps.apiKey, deps.issueId, body);
  } catch (err) {
    deps.log(`! comment-sync: plan comment create failed: ${(err as Error).message}`, "yellow");
    return null;
  }
  await patchComments(deps.statePath, {
    planCommentId: id,
    planPostedAt: new Date().toISOString(),
  });
  deps.log(`  comment-sync: posted plan comment for ${deps.changeName}`, "gray");
  return id;
}

/**
 * Fresh steering comment + tasks-comment refresh. Posts the steering
 * message as its own comment (never updated), then deletes the existing
 * tasks comment (if any) and re-creates it so it lands at the bottom of
 * the timeline. The new tasks comment id is persisted in place of the
 * old one.
 */
export async function postSteeringAndRefreshTasks(deps: SteeringDeps): Promise<void> {
  const firstLine = deps.message.split(/\r?\n/, 1)[0]!.trim() || deps.message.trim();
  const steeringBody = `### ${STEERING_COMMENT_TITLE}\n\n${deps.message.trim()}`;

  try {
    await deps.mutations.createIssueComment(deps.apiKey, deps.issueId, steeringBody);
    deps.log(`  comment-sync: posted steering comment (${firstLine})`, "gray");
  } catch (err) {
    deps.log(`! comment-sync: steering comment create failed: ${(err as Error).message}`, "yellow");
    // Don't bail — still try to refresh tasks comment.
  }

  const comments = await readComments(deps.statePath);

  if (comments.tasksCommentId) {
    try {
      await deps.mutations.deleteIssueComment(deps.apiKey, comments.tasksCommentId);
      deps.log(`  comment-sync: deleted old tasks comment`, "gray");
    } catch (err) {
      if (!isCommentNotFoundError(err)) {
        deps.log(`! comment-sync: deleteIssueComment failed: ${(err as Error).message}`, "yellow");
      }
    }
    // Clear the persisted id + hash regardless — either it's gone, or
    // we failed to delete it but want a fresh one to land last anyway.
    await patchComments(deps.statePath, { tasksCommentId: null, tasksCommentSha256: null });
  }

  await postOrUpdateTasksComment({
    apiKey: deps.apiKey,
    issueId: deps.issueId,
    statePath: deps.statePath,
    changeDir: deps.changeDir,
    changeName: deps.changeName,
    log: deps.log,
    mutations: deps.mutations,
    iteration: deps.iteration,
  });
}
