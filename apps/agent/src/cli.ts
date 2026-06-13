import { log } from "@ralphy/output";
import type { Indicators, Marker, SetIndicator, GetIndicator } from "@ralphy/types";
import { VERSION } from "@ralphy/version";
import {
  emptyCommonArgs,
  parseCommonArg,
  emptyParseState,
  resolvePromptFile,
  resolveWorkflowFile,
  type AgentOverrides,
  type CommonArgs,
} from "@ralphy/cli-args";

export { VERSION };

export type AgentMode = "agent" | "list" | "stop" | "status";

export interface AgentParsedArgs extends CommonArgs {
  mode: AgentMode;
  /** Sparse config overrides for the agent-only flags (`--concurrency`,
   *  `--poll-interval`, `--linear-team`, `--worktree`, `--create-pr`,
   *  `--stack-prs`, `--code-review`) — exactly the keys argv set. Merged onto
   *  WORKFLOW.md by `@ralphy/config` with `cli > workflow > default`; callers
   *  read the merged value from `resolved.effective`, never from here. */
  agentOverrides: AgentOverrides;
  /** Runtime assignee override (me / any / unassigned / <email> / <id>). Replaces
   *  the `assignee` clause of the config's `linear.filter` for this run. */
  linearAssignee: string;
  /** CLI overrides for the indicator map. Wire layer merges these onto
   *  the config's `linear.indicators`; CLI wins on conflict. */
  indicators: Partial<Indicators>;
  /** Stop picking up new issues after this many have been started (0 = unlimited). */
  maxTickets: number;
  /** Emit JSONL to stdout instead of rendering the Ink dashboard. */
  jsonOutput: boolean;
  /** Optional path to mirror JSONL events to a file (works in both TUI and --json-output modes). */
  jsonLogFile?: string;
  /** List mode: enable per-ticket diagnostics for --name <identifier>. */
  debug: boolean;
  /** Opt-in: after each ticket reaches a terminal disposition, spawn a one-shot
   *  engine pass that self-reviews the run and writes a markdown report to
   *  `~/.ralph/retro/`. Off by default; adds cost only when set. */
  agentDebug: boolean;
  /** Force-enable the pre-existing-error baseline gate (overrides config). */
  preExistingErrorCheck?: boolean;
  /** Disable tmux session management; run agent in the foreground directly. */
  noTmux: boolean;
  /** RLF-97 override: when defined, force PR recovery on/off regardless of
   *  the `prRecovery.enabled` workflow config. `--no-pr-recovery` sets false. */
  prRecoveryEnabled?: boolean;
  /** List mode: show failing CI check names per PR. */
  checks: boolean;
  /** List mode: show unresolved review comment count per PR. */
  review: boolean;
  /** RLF-208: raw `--ticket` tokens (identifiers or bare numbers). Resolved to
   *  ticket numbers + validated against the configured team in the wire layer.
   *  Empty array = no ticket constraint (default behaviour). */
  ticketTokens: string[];
}

// allow-duplicate
const VALID_MODES = new Set<string>(["agent", "list", "stop", "status"]);

const INDICATOR_KEYS = new Set<keyof Indicators>([
  "getTodo",
  "getInProgress",
  "getAutoMerge",
  "setInProgress",
  "setDone",
  "setPrReady",
  "setError",
]);
const GET_KEYS = new Set<keyof Indicators>(["getTodo", "getInProgress", "getAutoMerge"]);

// allow-duplicate
const HELP_TEXT = [
  `ralphy agent v${VERSION}`,
  "",
  "Usage: ralphy agent [command] [options]",
  "",
  "Commands:",
  "  (default)               Poll Linear and run task loops concurrently (requires LINEAR_API_KEY)",
  "  list                    List active changes + Linear tickets per indicator bucket",
  "  stop                    Kill the managed tmux agent session for this workspace",
  "  status                  Report whether the managed tmux agent session exists and is attached",
  "",
  "Options:",
  "  --name <id>             Change name / ticket identifier (list / debug filter)",
  "  --workflow <path>       Path to an alternate WORKFLOW.md (default: <project>/WORKFLOW.md)",
  "  --prompt <text>         Task description appended to every scaffolded proposal",
  "  --prompt-file <path>    Read prompt from file",
  "  --model <model>         Set model (fable|opus|sonnet|haiku)",
  "  --claude [model]        Use Claude engine (fable|opus|sonnet|haiku, default: opus)",
  "  --codex                 Use Codex engine",
  "  --delay <seconds>       Seconds between iterations",
  "  --max-iterations <n>    Stop after N iterations (0 = unlimited)",
  "  --max-cost <n>          Stop when total cost exceeds $N (0 = no limit)",
  "  --max-runtime <n>       Stop after N minutes of wall-clock time (0 = no limit)",
  "  --max-failures <n>      Stop after N consecutive failures (default: 5)",
  "  --unlimited             No iteration limit (default)",
  "  --manual-test           Enable manual testing phase passthrough",
  "  --log                   Log raw engine stream",
  "  --verbose               Verbose output",
  "  --linear-team <key>     Linear team key (e.g. ENG)",
  "  --linear-assignee <id>  Assignee override (me / any / unassigned / <email> / <id>); overrides linear.filter's assignee clause",
  "  --poll-interval <s>     Seconds between Linear polls (default: 60)",
  "  --concurrency <n>       Max concurrent task loops (default: 1)",
  "  --worktree              Run each task in its own git worktree",
  "  --indicator <k>:<t>:<v> Override an indicator (repeatable).",
  "                          Keys: getTodo, getInProgress, getAutoMerge,",
  "                                setInProgress, setDone, setPrReady, setError",
  "                          Types: label, status, attachment, project, comment",
  "                          --indicator setInProgress:attachment:In Progress",
  "                          --indicator setPrReady:status:In Review (additive ready marker)",
  "                          (attachment upserts a single 'Ralphy' entry; value = subtitle)",
  "  --create-pr             Push the worker branch and open a GitHub PR on success (needs --worktree)",
  "  --stack-prs             Base the PR on a blocker issue's open-PR head branch when present (needs --create-pr)",
  "  --code-review           Watch open tracked PRs for unresolved review comments",
  "  --max-tickets <n>       Stop picking up new issues after N have been started (0 = unlimited)",
  "  --ticket <id>           Restrict issue discovery to specific ticket(s); repeatable or comma-separated (e.g. RLF-208 or 208)",
  "  --no-tmux               Disable tmux session management; run agent in the foreground directly",
  "  --no-pr-recovery        Disable PR recovery (conflict + CI watcher) for this run; --pr-recovery forces it on",
  "  --json-output           Emit JSONL to stdout instead of the Ink dashboard (for scripting/CI)",
  "                          (auto-enabled when stdin is not a TTY, e.g. pipes / nohup / CI)",
  "  --json-log-file <path>  Mirror JSONL events to a file (works alongside TUI or --json-output)",
  "  --pre-existing-error-check  Run baseline commands against the base branch; pause new pickups + open a Linear ticket when red",
  "  --checks                List mode: show failing CI check names per PR",
  "  --review                List mode: show unresolved review comment count per PR",
  "  --debug                 List mode: explain why a Linear ticket was not picked up (use with --name)",
  "  --agent-debug           After each ticket finishes, run a one-shot self-review and write a report to ~/.ralph/retro/",
  "  --help, -h              Show this help message",
  "",
  "Examples:",
  "  ralphy agent --indicator getTodo:status:Todo --indicator setDone:status:Done",
  "  ralphy agent --worktree --create-pr --max-tickets 5",
  "  ralphy agent list",
  "  ralphy agent list --debug --name ENG-123",
].join("\n");

export function printAgentHelp(): void {
  log(HELP_TEXT);
}

function parseIndicatorArg(raw: string): { key: keyof Indicators; marker: Marker } {
  const firstColon = raw.indexOf(":");
  if (firstColon < 0) {
    const err = new Error("--indicator expects key:type:value") as Error & { input?: string };
    err.input = raw;
    throw err;
  }
  const secondColon = raw.indexOf(":", firstColon + 1);
  if (secondColon < 0) {
    const err = new Error("--indicator expects key:type:value") as Error & { input?: string };
    err.input = raw;
    throw err;
  }
  const key = raw.slice(0, firstColon) as keyof Indicators;
  const type = raw.slice(firstColon + 1, secondColon) as Marker["type"];
  const value = raw.slice(secondColon + 1);
  if (!INDICATOR_KEYS.has(key)) {
    const err = new Error("unknown indicator key") as Error & { key?: string };
    err.key = key;
    throw err;
  }
  if (
    type !== "label" &&
    type !== "status" &&
    type !== "attachment" &&
    type !== "project" &&
    type !== "comment"
  ) {
    const err = new Error(
      "indicator type must be 'label', 'status', 'attachment', 'project', or 'comment'",
    ) as Error & { type?: string };
    err.type = type;
    throw err;
  }
  if (!value) throw new Error("indicator value cannot be empty");
  return { key, marker: { type, value } };
}

function mergeIndicator(bag: Partial<Indicators>, key: keyof Indicators, marker: Marker): void {
  if (GET_KEYS.has(key)) {
    const existing = bag[key] as GetIndicator | undefined;
    const filter = existing ? [...existing.filter, marker] : [marker];
    (bag as Record<string, GetIndicator>)[key] = { filter };
  } else {
    const existing = bag[key] as SetIndicator | undefined;
    const next: SetIndicator = existing
      ? [...(Array.isArray(existing) ? existing : [existing]), marker]
      : marker;
    (bag as Record<string, SetIndicator>)[key] = next;
  }
}

export async function parseAgentArgs(argv: string[]): Promise<AgentParsedArgs> {
  const result: AgentParsedArgs = {
    ...emptyCommonArgs(),
    mode: "agent",
    agentOverrides: {},
    linearAssignee: "",
    indicators: {},
    maxTickets: 0,
    jsonOutput: false,
    debug: false,
    noTmux: false,
    checks: false,
    review: false,
    agentDebug: false,
    ticketTokens: [],
  };

  const state = emptyParseState();
  let expectLinearTeam = false;
  let expectLinearAssignee = false;
  let expectPollInterval = false;
  let expectConcurrency = false;
  let expectMaxTickets = false;
  let expectIndicator = false;
  let expectJsonLogFile = false;
  let expectTicket = false;

  for (const arg of argv) {
    if (expectLinearTeam) {
      result.agentOverrides.linearTeam = arg;
      expectLinearTeam = false;
      continue;
    }
    if (expectLinearAssignee) {
      result.linearAssignee = arg;
      expectLinearAssignee = false;
      continue;
    }
    if (expectPollInterval) {
      result.agentOverrides.pollInterval = parseInt(arg, 10);
      expectPollInterval = false;
      continue;
    }
    if (expectConcurrency) {
      result.agentOverrides.concurrency = parseInt(arg, 10);
      expectConcurrency = false;
      continue;
    }
    if (expectMaxTickets) {
      result.maxTickets = parseInt(arg, 10);
      expectMaxTickets = false;
      continue;
    }
    if (expectIndicator) {
      const { key, marker } = parseIndicatorArg(arg);
      mergeIndicator(result.indicators, key, marker);
      expectIndicator = false;
      continue;
    }
    if (expectJsonLogFile) {
      result.jsonLogFile = arg;
      expectJsonLogFile = false;
      continue;
    }
    if (expectTicket) {
      for (const token of arg.split(",").map((t) => t.trim())) {
        if (token) result.ticketTokens.push(token);
      }
      expectTicket = false;
      continue;
    }

    if (parseCommonArg(arg, result, state)) continue;

    switch (arg) {
      case "--linear-team":
        expectLinearTeam = true;
        break;
      case "--linear-assignee":
        expectLinearAssignee = true;
        break;
      case "--poll-interval":
        expectPollInterval = true;
        break;
      case "--concurrency":
        expectConcurrency = true;
        break;
      case "--max-tickets":
        expectMaxTickets = true;
        break;
      case "--ticket":
        expectTicket = true;
        break;
      case "--worktree":
        result.agentOverrides.worktree = true;
        break;
      case "--indicator":
        expectIndicator = true;
        break;
      case "--create-pr":
        result.agentOverrides.createPr = true;
        break;
      case "--stack-prs":
        result.agentOverrides.stackPrs = true;
        break;
      case "--code-review":
        result.agentOverrides.codeReview = true;
        break;
      case "--json-output":
        result.jsonOutput = true;
        break;
      case "--json-log-file":
        expectJsonLogFile = true;
        break;
      case "--checks":
        result.checks = true;
        break;
      case "--review":
        result.review = true;
        break;
      case "--debug":
        result.debug = true;
        break;
      case "--agent-debug":
        result.agentDebug = true;
        break;
      case "--pre-existing-error-check":
        result.preExistingErrorCheck = true;
        break;
      case "--no-tmux":
        result.noTmux = true;
        break;
      case "--no-pr-recovery":
        result.prRecoveryEnabled = false;
        break;
      case "--pr-recovery":
        result.prRecoveryEnabled = true;
        break;
      default:
        if (VALID_MODES.has(arg)) {
          result.mode = arg as AgentMode;
        } else {
          throw new Error("Unknown argument. Run 'ralphy agent --help' for usage information.");
        }
        break;
    }
  }

  await resolvePromptFile(result, state);
  resolveWorkflowFile(result, state);

  if (result.agentOverrides.stackPrs && !result.agentOverrides.createPr) {
    throw new Error("--stack-prs requires --create-pr");
  }

  return result;
}
