import { getLayout, getArgs } from "@ralphy/context";
import { resolveLinearFilter, linearFilterScope, applyAssigneeOverride } from "@ralphy/workflow";
import type { Indicators } from "@ralphy/types";
import { loadEffectiveConfig } from "./agent/config";
import { fetchViewer } from "./shared/capabilities/linear-client/request";
import type { CmdRunner } from "./agent/pr";
import {
  resolveTicketNumbers,
  formatTicketError,
} from "./shared/capabilities/linear-client/ticket-identifier";
import { buildBuckets } from "./list/formatting";
import { buildLocalRows, printLocalRows } from "./list/local-rows";
import { fetchAndPrintLinear } from "./list/linear-rows";
import { runListDebug } from "./list/linear-debug";

const localCmdRunner: CmdRunner = {
  run: async (cmd, cwd) => {
    const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const err = new Error(`\`${cmd.join(" ")}\` exited ${code}`) as Error & {
        stderr?: string;
      };
      err.stderr = stderr;
      throw err;
    }
    return { stdout, stderr };
  },
};

interface RunListInput {
  linearTeamOverride: string | undefined;
  linearAssigneeOverride: string;
  debug: boolean;
  name: string;
  checks: boolean;
  review: boolean;
  /** RLF-208: raw `--ticket` tokens to restrict the listing to. */
  ticketTokens?: string[];
}

export async function runList(input: RunListInput): Promise<void> {
  const { debug, name } = input;
  const projectRoot = getLayout().root;

  if (debug) {
    if (!name) {
      process.stderr.write("Error: --name is required when using --debug\n");
      process.exitCode = 1;
      return;
    }
    await runListDebug({
      identifier: name,
      projectRoot,
      linearTeamOverride: input.linearTeamOverride,
      linearAssigneeOverride: input.linearAssigneeOverride,
    });
    return;
  }

  const rows = buildLocalRows();
  printLocalRows(rows);

  const args = getArgs();
  const extra =
    input.linearTeamOverride === undefined ? {} : { linearTeam: input.linearTeamOverride };
  const cfg = await loadEffectiveConfig(projectRoot, args.workflowFile, args.overrides, extra);
  const apiKey = process.env["LINEAR_API_KEY"];
  const indicators = cfg.linear.indicators as Indicators;
  const team = cfg.linear.team;
  const resolved = resolveLinearFilter(
    applyAssigneeOverride(cfg.linear.filter, input.linearAssigneeOverride),
  );
  const { assignee, anyAssignee } = resolved;
  const scope = linearFilterScope(resolved);
  const buckets = buildBuckets(indicators);
  const anyConfigured = buckets.some((b) => b.indicator && b.indicator.filter.length > 0);

  if (!anyConfigured) {
    process.stdout.write(
      "\nLinear: no get* indicators configured in WORKFLOW.md — skipping ticket fetch.\n",
    );
    return;
  }

  if (!apiKey) {
    process.stdout.write(
      "\nLinear: LINEAR_API_KEY not set — cannot fetch tickets. Configured buckets:\n",
    );
    for (const bucket of buckets) {
      if (!bucket.indicator || bucket.indicator.filter.length === 0) continue;
      const filterStr = bucket.indicator.filter.map((m) => `${m.type}:${m.value}`).join(", ");
      process.stdout.write(`  ${bucket.label} [${filterStr}]\n`);
    }
    return;
  }

  let ticketNumbers: number[] = [];
  try {
    ticketNumbers = resolveTicketNumbers(input.ticketTokens ?? [], team);
  } catch (err) {
    process.stderr.write(`Error: ${formatTicketError(err)}\n`);
    process.exitCode = 1;
    return;
  }

  if (team) process.stdout.write(`\nteam: ${team}\n`);
  process.stdout.write(`assignee: ${anyAssignee ? "any" : (assignee ?? "*")}\n`);
  if (ticketNumbers.length > 0) process.stdout.write(`ticket: ${ticketNumbers.join(", ")}\n`);

  // Surface the authenticated user so a key that resolves `assignee: me` to the
  // wrong account (or no account) is visible — otherwise it silently fetches
  // zero tickets and looks like nothing matched.
  const viewer = await fetchViewer(apiKey);
  if (viewer) {
    process.stdout.write(`authed as: ${viewer.name} <${viewer.email}>\n`);
  } else {
    process.stdout.write(
      "authed as: (LINEAR_API_KEY did not resolve a user — key may be invalid or expired)\n",
    );
  }

  await fetchAndPrintLinear(
    apiKey,
    buckets,
    team,
    assignee,
    anyAssignee,
    scope,
    projectRoot,
    localCmdRunner,
    cfg.prRecovery.ignoreChecks,
    input.checks,
    input.review,
    ticketNumbers,
  );
}
