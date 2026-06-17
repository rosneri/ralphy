/**
 * Core logic for `ralph debug --name <changeName>`.
 *
 * Reads both the text agent log (~/.ralph/agent-mode.log) and the project-
 * level JSONL log (<projectRoot>/.ralph/agent.log), queries Linear for the
 * current ticket state, queries GitHub for the current PR state, and prints
 * a merged timeline plus a diagnosis of what went wrong.
 *
 * All side effects go through the injected `DebugIo` (see debug-io.ts) so the
 * orchestration here stays unit-testable with a fake.
 */

import { join } from "node:path";
import type { RalphEvent } from "@ralphy/events";
import { WORKER_EXIT_CODES } from "@ralphy/types";
import { defaultDebugIo } from "./debug-io";
import type { DebugIo } from "./debug-io";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface DebugLogLine {
  ts: Date;
  type: string;
  text: string;
}

function fmtTs(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 23);
}

// ---------------------------------------------------------------------------
// Text log parsing (format: "[ISO-TS] [type] message")
// ---------------------------------------------------------------------------

const LOG_LINE_RE = /^\[(.+?)\] \[(.+?)\] (.+)$/;

export function parseTextLog(content: string): DebugLogLine[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const m = LOG_LINE_RE.exec(line);
      if (!m) return [];
      const ts = new Date(m[1]!);
      if (isNaN(ts.getTime())) return [];
      return [{ ts, type: m[2]!, text: m[3]! }];
    });
}

// ---------------------------------------------------------------------------
// JSONL log parsing (format: {"ts":epoch_ms, "type":string, ...})
// Used by the project-level agent.log when running in JSON/dashboard mode.
// ---------------------------------------------------------------------------

// The project-level `agent.log` persists `RalphEvent` values as JSONL, so the
// reader's view is derived straight from the canonical union (RLF-254) rather
// than re-declaring each field. `prUrl` is the pre-8a name for `worker_pr`'s
// `url`; it is intersected back in here — and ONLY here — so historical log
// lines written before the rename still render.
type JsonlEntry = RalphEvent & { prUrl?: string };

export function parseJsonlLog(content: string, filterChangeName?: string): DebugLogLine[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      let entry: JsonlEntry;
      try {
        entry = JSON.parse(line) as JsonlEntry;
      } catch {
        return [];
      }

      const ts = new Date(entry.ts);
      if (isNaN(ts.getTime())) return [];

      const changeName = "changeName" in entry ? entry.changeName : undefined;

      // If filtering by changeName, skip entries for other changes
      if (filterChangeName && changeName && changeName !== filterChangeName) {
        return [];
      }

      const cn = changeName ?? "";

      switch (entry.type) {
        case "started":
          return [{ ts, type: "agent", text: `agent started v${entry.version ?? "?"}` }];
        case "stopped":
          return [{ ts, type: "agent", text: "agent stopped" }];
        case "worker_started":
          return [{ ts, type: "spawn", text: `${cn}: worker spawned` }];
        case "worker_phase": {
          const detail = entry.detail ? ` (${entry.detail})` : "";
          return [{ ts, type: "phase", text: `${cn}: ${entry.phase}${detail}` }];
        }
        case "worker_cmd_start":
          return [
            {
              ts,
              type: "cmd",
              text: `${cn}: → ${(entry.cmd ?? []).slice(0, 4).join(" ")}`,
            },
          ];
        case "worker_cmd_end":
          return [
            {
              ts,
              type: "cmd",
              text: `${cn}: ← ${(entry.cmd ?? []).slice(0, 2).join(" ")} (${entry.durationMs}ms, ${entry.ok ? "ok" : "err"})`,
            },
          ];
        case "worker_pr":
          return [{ ts, type: "pr", text: `${cn}: PR → ${entry.url ?? entry.prUrl}` }];
        case "worker_exited":
          return [
            {
              ts,
              type: "exit",
              text: `${cn}: exited (code ${entry.exitCode ?? "?"})`,
            },
          ];
        case "log":
          return [{ ts, type: "coord", text: entry.text ?? "" }];
        case "poll_done":
          return [
            {
              ts,
              type: "poll",
              text: `poll: found=${entry.found} added=${entry.added}`,
            },
          ];
        default:
          return [];
      }
    });
}

// ---------------------------------------------------------------------------
// Stuck-loop detection
// ---------------------------------------------------------------------------

interface StuckInfo {
  phase: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  minutesStuck: number;
  watchingPrUrl: string | undefined;
}

export function detectDebugStuck(lines: DebugLogLine[]): StuckInfo | null {
  if (lines.length < 10) return null;

  // Count repeats of the same phase in the last 20 entries
  const recent = lines.slice(-20).filter((l) => l.type === "phase");
  if (recent.length < 5) return null;

  const phaseNames = recent.map((l) => l.text.split(": ").slice(1).join(": "));
  const unique = new Set(phaseNames);
  if (unique.size !== 1) return null;

  const phase = phaseNames[0]!;

  // Count total occurrences across the full timeline
  const all = lines.filter((l) => l.type === "phase" && l.text.includes(phase));
  const first = all[0]!;
  const last = all[all.length - 1]!;
  const minutesStuck = (last.ts.getTime() - first.ts.getTime()) / 60_000;

  // Extract the PR URL being polled (from pr-type entries or cmd entries)
  const prEntry = lines.find((l) => l.type === "pr");
  const cmdEntry = lines.find(
    (l) => l.type === "cmd" && l.text.includes("gh") && l.text.includes("mergeable"),
  );
  const watchingPrUrl =
    prEntry?.text.split("PR → ")[1] ?? cmdEntry?.text.match(/https:\/\/github\.com\/[^\s)]+/)?.[0];

  return {
    phase,
    count: all.length,
    firstSeen: first.ts,
    lastSeen: last.ts,
    minutesStuck,
    watchingPrUrl,
  };
}

// ---------------------------------------------------------------------------
// Resolve changeName / issueIdentifier — searches the already-read log lines
// ---------------------------------------------------------------------------

const SPAWN_RE = /▶ (\S+) → (\S+)/;

export function resolveDebugTarget(
  allLines: DebugLogLine[],
  opts: { name?: string; issue?: string },
): { changeName: string; identifier: string | undefined } {
  if (opts.name && !opts.issue) {
    // Try to find identifier from spawn events
    for (const line of allLines) {
      const m = SPAWN_RE.exec(line.text);
      if (m && m[2] === opts.name) return { changeName: opts.name, identifier: m[1] };
    }
    // Also try JSONL worker_started or log lines that reference the change
    for (const line of allLines) {
      if (line.text.includes(opts.name) && line.text.includes("COD-")) {
        const id = /COD-\d+/.exec(line.text)?.[0];
        if (id) return { changeName: opts.name, identifier: id };
      }
    }
    return { changeName: opts.name, identifier: undefined };
  }

  if (opts.issue && !opts.name) {
    // Search for the changeName in log events
    const pattern = new RegExp(`(cod-${opts.issue.toLowerCase().replace("cod-", "")}[\\w-]+)`);
    for (const line of allLines) {
      const m = pattern.exec(line.text);
      if (m) return { changeName: m[1]!, identifier: opts.issue };
    }
    // Also search spawn lines
    for (const line of allLines) {
      const m = SPAWN_RE.exec(line.text);
      if (m && m[1] === opts.issue) return { changeName: m[2]!, identifier: opts.issue };
    }
    return { changeName: opts.issue, identifier: opts.issue };
  }

  return { changeName: opts.name!, identifier: opts.issue };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDebug(
  opts: { name?: string; issue?: string; projectRoot: string },
  io: DebugIo = defaultDebugIo,
): Promise<void> {
  const { projectRoot } = opts;
  const out = io.out;

  // Read both log sources
  const textLog = await io.readOptionalText(io.agentLogPath());
  const textLines = textLog !== null ? parseTextLog(textLog) : [];

  const jsonlLogPath = join(projectRoot, ".ralph", "agent.log");
  const jsonlLogRaw = await io.readOptionalText(jsonlLogPath);

  // Resolve the change name from the combined logs
  const resolveLines = [...textLines, ...(jsonlLogRaw !== null ? parseJsonlLog(jsonlLogRaw) : [])];
  let { changeName, identifier: issueIdentifier } = resolveDebugTarget(resolveLines, {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.issue !== undefined ? { issue: opts.issue } : {}),
  });

  if (!changeName) {
    io.errOut(`! Could not resolve change name for ${opts.issue ?? opts.name}.\n`);
    io.exit(1);
  }

  // Parse JSONL log filtered to this change
  const jsonlLines = jsonlLogRaw !== null ? parseJsonlLog(jsonlLogRaw, changeName) : [];

  // Filter text log to this change
  const relevantText = textLines.filter(
    (l) =>
      l.text.includes(changeName) ||
      (issueIdentifier !== undefined && l.text.includes(issueIdentifier)),
  );

  // Worker text log
  const workerLogRaw = await io.readOptionalText(
    join(projectRoot, ".ralph", "logs", `${changeName}.log`),
  );
  const workerLines = workerLogRaw !== null ? parseTextLog(workerLogRaw) : [];

  // Merge all sources, sort, deduplicate
  const merged = [...relevantText, ...jsonlLines, ...workerLines].sort((a, b) => +a.ts - +b.ts);
  const seen = new Set<string>();
  const timeline = merged.filter((l) => {
    const key = `${l.ts.getTime()}:${l.type}:${l.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Extract identifier from timeline if not yet known
  if (!issueIdentifier) {
    for (const line of timeline) {
      const m = SPAWN_RE.exec(line.text);
      if (m && m[2] === changeName) {
        issueIdentifier = m[1];
        break;
      }
      if (line.text.includes(changeName)) {
        const id = /(COD|ENG|DEV)-\d+/.exec(line.text)?.[0];
        if (id) {
          issueIdentifier = id;
          break;
        }
      }
    }
  }

  // Detect stuck loop
  const stuck = detectDebugStuck(timeline);

  // Binary info
  const binary = await io.inspectBinary(projectRoot);

  out(`\n=== Ralph Debug: ${changeName}${issueIdentifier ? ` (${issueIdentifier})` : ""} ===\n`);

  // ── Timeline ──
  out("── Timeline ─────────────────────────────────────────────────────────");
  if (!timeline.length) {
    out("  (no log entries found)");
  } else {
    // If stuck, show the non-phase events + "... N repeated ..."
    if (stuck && timeline.length > 20) {
      const phaseLines = timeline.filter((l) => l.type === "phase" && l.text.includes(stuck.phase));
      const nonPhase = timeline.filter(
        (l) => !(l.type === "phase" && l.text.includes(stuck.phase)),
      );
      for (const line of nonPhase) {
        const prefix = line.type === "output" ? "  │" : "  ·";
        out(`${prefix} ${fmtTs(line.ts)}  [${line.type.padEnd(7)}]  ${line.text}`);
      }
      out(
        `  ↺ ... ${phaseLines.length}× ${stuck.phase} (${stuck.minutesStuck.toFixed(1)} min) ...`,
      );
    } else {
      for (const line of timeline) {
        const prefix = line.type === "output" ? "  │" : "  ·";
        out(`${prefix} ${fmtTs(line.ts)}  [${line.type.padEnd(7)}]  ${line.text}`);
      }
    }
  }
  out("");

  // ── Binary ──
  if (binary) {
    out("── Installed binary ─────────────────────────────────────────────────");
    out(`  Path             : ${binary.path}`);
    out(`  Embedded version : ${binary.embeddedVersion ?? "(unknown)"}`);
    if (binary.builtAt) out(`  Built at         : ${fmtTs(binary.builtAt)}`);
    out("");
  }

  // ── Linear ──
  out("── Current Linear state ─────────────────────────────────────────────");
  if (!issueIdentifier) {
    out("  (unknown identifier — pass --issue to query Linear directly)");
  } else if (!io.linearApiKey()) {
    out("  (set LINEAR_API_KEY to fetch current Linear state)");
  } else {
    const issue = await io.fetchLinearIssue(issueIdentifier);
    if (!issue) {
      out(`  ! Could not fetch ${issueIdentifier} from Linear`);
    } else {
      const labels = issue.labels.nodes.map((l) => l.name).join(", ") || "(none)";
      out(`  Title  : ${issue.title}`);
      out(`  Status : ${issue.state.name} (${issue.state.type})`);
      out(`  Labels : ${labels}`);
      out(`  URL    : ${issue.url}`);
    }
  }
  out("");

  // ── GitHub PR ──
  out("── Current GitHub PR ────────────────────────────────────────────────");
  const pr = await io.fetchGithubPr(changeName);
  if (!pr) {
    // If we know a PR URL from the log, fetch mergeability directly
    if (stuck?.watchingPrUrl) {
      const m = io.fetchMergeableNow(stuck.watchingPrUrl);
      out(`  Watching : ${stuck.watchingPrUrl}`);
      out(`  Mergeable: ${m ?? "(error fetching)"}`);
    } else {
      out(`  (no PR found for branch ralph/${changeName})`);
    }
  } else {
    const failing = pr.checks.filter(
      (c) => c.conclusion === "FAILURE" || c.conclusion === "failure",
    );
    const pending = pr.checks.filter((c) => c.state === "PENDING" || c.state === "IN_PROGRESS");
    out(`  PR #${pr.number} : ${pr.url}`);
    out(`  State     : ${pr.state}`);
    out(`  Mergeable : ${pr.mergeable}`);
    if (pr.checks.length) {
      out(
        `  Checks    : ${pr.checks.length} total, ${failing.length} failing, ${pending.length} pending`,
      );
      for (const c of failing) out(`    ✗ ${c.name}`);
      for (const c of pending) out(`    ⧗ ${c.name}`);
    } else {
      out("  Checks    : (none or not yet available)");
    }
  }
  out("");

  // ── Diagnosis ──
  out("── Diagnosis ────────────────────────────────────────────────────────");

  const lastEvent = timeline.at(-1);
  if (lastEvent) out(`  Last event : ${fmtTs(lastEvent.ts)}  ${lastEvent.text}`);

  const exitLine = timeline.find((l) => /exited \(code \d+\)/.test(l.text));
  if (exitLine) {
    const code = Number(/code (\d+)/.exec(exitLine.text)?.[1]);
    const meaning =
      code === 0
        ? "success"
        : code === WORKER_EXIT_CODES.ciFailed
          ? "CI fix loop exhausted its attempt budget"
          : code === WORKER_EXIT_CODES.prFailed
            ? "push or PR creation failed"
            : "worker subprocess failed";
    out(`  Exit code  : ${code} — ${meaning}`);
  }

  // Stuck loop diagnosis
  if (stuck) {
    out(
      `  ⚠ STUCK in ${stuck.phase} — ${stuck.count} iterations over ${stuck.minutesStuck.toFixed(1)} min`,
    );
    if (stuck.watchingPrUrl) {
      const mergeable = io.fetchMergeableNow(stuck.watchingPrUrl);
      out(`    Watching  : ${stuck.watchingPrUrl}`);
      out(`    Mergeable : ${mergeable ?? "(error)"} (live fetch)`);
      if (mergeable === "MERGEABLE") {
        out(`    → PR is MERGEABLE — loop should have exited. Likely cause:`);
        if (binary?.embeddedVersion && binary.embeddedVersion < "2.17.1") {
          out(
            `      Local binary is v${binary.embeddedVersion} (fix shipped in v2.17.1). Update with:`,
          );
          out(`      cd ${projectRoot} && bunx @neriros/ralphy@latest make-install`);
        } else {
          out(`      This is the conflict-check infinite loop bug (fixed in v2.17.1).`);
          out(`      Restart the agent after updating to v2.17.1.`);
        }
      }
    }
  }

  // Binary version mismatch
  if (binary) {
    const embV = binary.embeddedVersion ?? "?";
    const logV = timeline
      .find((l) => l.text.includes("agent started"))
      ?.text.match(/v([\d.]+)/)?.[1];
    if (logV && embV !== logV) {
      out(`  ⚠ Version mismatch: binary says v${embV}, agent reported v${logV}`);
      out(`    The binary reads version from a package.json at runtime — the actual`);
      out(`    running code is v${embV}, not v${logV}. Update the local install.`);
    }
  }

  const logHas = (s: string) => timeline.some((l) => l.text.includes(s));
  if (logHas("setError applied")) out("  ⚠ setError applied — issue is quarantined in Linear");
  if (logHas("setDone applied")) out("  ✓ setDone applied — issue marked done in Linear");
  if (logHas("setPrReady applied")) out("  ✓ setPrReady applied — PR is ready for human review");
  if (logHas("clearConflicted applied")) out("  ✓ clearConflicted applied");
  if (logHas("setConflicted applied")) out("  ⚠ setConflicted applied — merge conflicts detected");
  if (logHas("skipping PR phase")) out("  ↩ PR phase skipped — worker exited non-zero");

  if (pr?.mergeable === "CONFLICTING") out("  ⚠ PR currently has merge conflicts");
  if (pr?.checks.some((c) => c.conclusion === "FAILURE")) out("  ⚠ PR has failing CI checks");

  const worktreePath = join(projectRoot, ".ralph", "worktrees", changeName);
  if (await io.pathExists(join(worktreePath, ".git"))) {
    out(`  Worktree   : ${worktreePath}`);
  }

  if (!timeline.length) out("  (no log entries — has this change been started yet?)");

  out("");
}
