import { join } from "node:path";
import { agentRunStatePath } from "../../state/agent-run-state";
import {
  detectCheckoutLeak,
  snapshotCheckout,
  type CheckoutSnapshot,
} from "@ralphy/core/main-checkout-sentinel";
import { fetchIssueComments } from "../../../shared/capabilities/linear-client/comments";
import type { TrackedComment, TrackedIssue } from "@ralphy/tracker";
import type { RetroDispositionInfo } from "../../post-task";
import { runRetrospective, type RetroContext } from "@ralphy/retro";
import { runEngine } from "@ralphy/engine/engine";
import type { Bus } from "@ralphy/events";
import { emitCapture } from "../../../runtime/coordinator";
import type { AgentParsedArgs } from "../../../cli";
import type { RalphyConfig } from "../../config";
import type { GitRunner } from "../../worktree";

/** Local `YYYY-MM-DD` for the retrospective filename + dedupe key. */
function localDateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build a compact ticket digest from an issue + its comments for the retro. */
function buildTicketDigest(issue: TrackedIssue | null, comments: TrackedComment[]): string {
  if (!issue) return "(ticket details unavailable)";
  const lines = [`Title: ${issue.title}`, "", issue.description?.trim() || "(no description)"];
  if (comments.length > 0) {
    lines.push("", "Comments:");
    for (const c of comments) {
      lines.push(`- ${c.user?.name ?? "unknown"}: ${c.body}`);
    }
  }
  return lines.join("\n");
}

/** Collaborators the `--agent-debug` retrospective hook closes over. */
interface RetrospectiveHookDependencies {
  apiKey: string;
  cfg: RalphyConfig;
  args: AgentParsedArgs;
  projectRoot: string;
  logsDir: string;
  prByChange: Map<string, string> | undefined;
  onLog: (text: string, color?: string) => void;
  retroSeen: Set<string>;
}

/**
 * Build the `--agent-debug` retrospective hook. One in-memory dedupe set
 * (`retroSeen`) is shared across every worker this run spawns; the returned
 * closure is passed to `runPostTask` only when the flag is set.
 */
export function createRetrospectiveHook(
  dependencies: RetrospectiveHookDependencies,
): (info: RetroDispositionInfo) => Promise<void> {
  const { apiKey, cfg, args, projectRoot, logsDir, prByChange, onLog, retroSeen } = dependencies;
  return async (info: RetroDispositionInfo): Promise<void> => {
    try {
      const identifier = info.issue?.identifier ?? info.changeName;
      const prUrl = prByChange?.get(info.changeName) ?? null;
      let digest = "(ticket details unavailable)";
      if (info.issue) {
        let comments: TrackedComment[] = [];
        try {
          comments = await fetchIssueComments(apiKey, info.issue.id);
        } catch {
          // Best-effort: a Linear fetch failure must not abort the retro.
        }
        digest = buildTicketDigest(info.issue, comments);
      }
      // cfg is the merged effective config (CLI overrides already applied).
      const { engine, model } = cfg;
      const ctx: RetroContext = {
        identifier,
        changeName: info.changeName,
        cwd: info.cwd,
        engine,
        model,
        exitCode: info.effectiveCode,
        prUrl,
        date: localDateStamp(new Date()),
        ticketDigest: digest,
        paths: {
          changeDir: info.changeDir,
          stateFilePath: info.stateFilePath,
          logFile: join(logsDir, `${info.changeName}.log`),
          jsonLogFile: args.jsonLogFile ?? null,
          agentStateFile: agentRunStatePath(projectRoot),
        },
      };
      await runRetrospective(ctx, {
        runEngine: (opts) => runEngine(opts),
        log: onLog,
        seen: retroSeen,
      });
    } catch (err) {
      onLog(`! retrospective failed: ${(err as Error).message}`, "yellow");
    }
  };
}

/** Collaborators the main-checkout leak reporter needs. */
interface CheckoutLeakDependencies {
  projectRoot: string;
  gitRunner: GitRunner;
  changeName: string;
  issueForChange: TrackedIssue | undefined;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  bus: Bus;
}

/**
 * RLF-224: compare the main checkout against the pre-spawn snapshot. Report
 * only — never `git restore`/`reset`, as the main tree may hold the
 * developer's own uncommitted work. When no snapshot was armed (`before` is
 * null) this is a no-op.
 */
export async function reportCheckoutLeak(
  before: CheckoutSnapshot | null,
  dependencies: CheckoutLeakDependencies,
): Promise<void> {
  const { projectRoot, gitRunner, changeName, issueForChange, onLog, diag, bus } = dependencies;
  if (!before) return;
  const after = await snapshotCheckout(projectRoot, gitRunner);
  const leak = detectCheckoutLeak(before, after);
  if (leak.leaked) {
    const detail = [
      leak.headMoved ? "HEAD moved" : null,
      leak.newEntries.length > 0 ? leak.newEntries.join(", ") : null,
    ]
      .filter(Boolean)
      .join("; ");
    const msg = `main checkout leak in ${projectRoot}: ${detail}`;
    onLog(msg, "red");
    diag("sentinel", msg, "red");
    emitCapture(bus, "agent_main_checkout_leak", {
      change_name: changeName,
      head_moved: leak.headMoved,
      leaked_paths: leak.newEntries,
      ...(issueForChange ? { issue_identifier: issueForChange.identifier } : {}),
    });
  }
}
