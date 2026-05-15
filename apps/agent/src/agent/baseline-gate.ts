import type { AgentCoordinator } from "./coordinator";
import { runBaseline, type BaselineResult } from "./baseline";
import type { CmdRunner } from "./pr";
import type { GitRunner } from "./worktree";

export interface BaselineGateLinear {
  /** Find the open baseline-error issue carrying our label, if any. */
  findOpen: () => Promise<{ id: string; identifier: string; description: string | null } | null>;
  /** Create a fresh baseline-error issue. */
  create: (title: string, description: string) => Promise<{ id: string; identifier: string }>;
  /** Replace the description body on an existing issue. */
  updateDescription: (id: string, description: string) => Promise<void>;
}

export interface BaselineGateDeps {
  enabled: boolean;
  commands: string[];
  baseBranch: string;
  outputCharLimit: number;
  cwd: string;
  cmdRunner: CmdRunner;
  gitRunner: GitRunner;
  coordinator: AgentCoordinator;
  /** Optional — when omitted, the gate runs the baseline locally but cannot
   *  create/refresh a Linear ticket. The pause is still applied. */
  linear?: BaselineGateLinear;
  onLog: (text: string, color?: string) => void;
  now?: () => number;
}

const FINGERPRINT_MARKER_RE = /<!--\s*ralphy:baseline:([a-f0-9]+)\s*-->/i;

/**
 * Run one tick of the pre-existing-error check.
 *
 * - Disabled or no commands → no-op.
 * - All commands green → clear coordinator pause (if set).
 * - Some commands red → upsert a Linear ticket and set the coordinator pause.
 */
export async function runBaselineGate(deps: BaselineGateDeps): Promise<void> {
  if (!deps.enabled) return;
  if (deps.commands.length === 0) {
    deps.onLog("  baseline check skipped — no commands configured", "gray");
    return;
  }

  let result: BaselineResult;
  try {
    result = await runBaseline({
      cmdRunner: deps.cmdRunner,
      gitRunner: deps.gitRunner,
      cwd: deps.cwd,
      commands: deps.commands,
      baseBranch: deps.baseBranch,
      outputCharLimit: deps.outputCharLimit,
    });
  } catch (err) {
    deps.onLog(`! baseline check errored: ${(err as Error).message}`, "yellow");
    return;
  }

  if (result.ok) {
    if (deps.coordinator.isPaused()) {
      deps.coordinator.clearPaused();
      deps.onLog("✓ baseline recovered — resuming new pickups", "green");
    }
    return;
  }

  // Baseline failed — set pause and upsert ticket.
  const firstFailure = result.failures[0]!;
  const description = renderIssueBody(result, deps.outputCharLimit);
  const title = `Pre-existing baseline error on ${deps.baseBranch}: \`${firstFailure.command}\``;

  let issueIdentifier = "BASELINE";
  let issueId: string | undefined;
  if (deps.linear) {
    try {
      const existing = await deps.linear.findOpen();
      if (existing) {
        const existingFp = extractFingerprint(existing.description ?? "");
        if (existingFp !== result.fingerprint) {
          await deps.linear.updateDescription(existing.id, description);
          deps.onLog(
            `  baseline ticket ${existing.identifier} updated (fingerprint changed)`,
            "yellow",
          );
        }
        issueIdentifier = existing.identifier;
        issueId = existing.id;
      } else {
        const created = await deps.linear.create(title, description);
        issueIdentifier = created.identifier;
        issueId = created.id;
        deps.onLog(`  baseline ticket ${created.identifier} created`, "yellow");
      }
    } catch (err) {
      deps.onLog(`! Linear baseline ticket sync failed: ${(err as Error).message}`, "red");
    }
  } else {
    deps.onLog(
      "! baseline failed but no Linear client configured — pausing without ticket",
      "yellow",
    );
  }

  const since = deps.coordinator.isPaused()
    ? (deps.coordinator.getPause()?.since ?? deps.now?.() ?? Date.now())
    : (deps.now?.() ?? Date.now());
  deps.coordinator.setPaused({
    issueIdentifier,
    ...(issueId !== undefined ? { issueId } : {}),
    command: firstFailure.command,
    fingerprint: result.fingerprint,
    since,
  });
}

function extractFingerprint(body: string): string | null {
  const m = FINGERPRINT_MARKER_RE.exec(body);
  return m?.[1] ?? null;
}

function renderIssueBody(result: BaselineResult, outputCharLimit: number): string {
  const lines: string[] = [];
  lines.push(`<!-- ralphy:baseline:${result.fingerprint} -->`);
  lines.push("");
  lines.push("Ralph detected a failing command on the base branch.");
  lines.push("");
  lines.push("New issues will not be picked up by Ralph until this is resolved.");
  lines.push("Mark this Linear issue as Done to lift the pause.");
  lines.push("");
  for (const f of result.failures) {
    lines.push(`### \`${f.command}\` — exit ${f.exitCode}`);
    lines.push("");
    if (f.stdout.trim()) {
      lines.push("**stdout:**");
      lines.push("```");
      lines.push(truncateForBody(f.stdout, outputCharLimit));
      lines.push("```");
    }
    if (f.stderr.trim()) {
      lines.push("**stderr:**");
      lines.push("```");
      lines.push(truncateForBody(f.stderr, outputCharLimit));
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function truncateForBody(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n…(truncated)`;
}
