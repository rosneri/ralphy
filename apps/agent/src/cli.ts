import { log } from "@ralphy/output";
import type { Indicators, Marker, SetIndicator, GetIndicator } from "@ralphy/types";
import { VERSION } from "@ralphy/version";
import {
  initialCommonArgs,
  parseCommonArg,
  emptyParseState,
  resolvePromptFile,
  type CommonArgs,
} from "@ralphy/cli-args";

export { VERSION };

export type AgentMode = "agent" | "list" | "stop" | "status";

export interface AgentParsedArgs extends CommonArgs {
  mode: AgentMode;
  linearTeam: string;
  linearAssignee: string;
  pollInterval: number;
  concurrency: number;
  worktree: boolean;
  /** CLI overrides for the indicator map. Wire layer merges these onto
   *  the config's `linear.indicators`; CLI wins on conflict. */
  indicators: Partial<Indicators>;
  createPr: boolean;
  fixCi: boolean;
  /** Open the PR against a blocker's open-PR head branch when the Linear
   *  issue is blocked-by another issue with a single open GitHub PR. */
  stackPrs: boolean;
  /** Enable the code-review trigger (overrides config). */
  codeReview: boolean;
  /** Stop picking up new issues after this many have been started (0 = unlimited). */
  maxTickets: number;
  /** Emit JSONL to stdout instead of rendering the Ink dashboard. */
  jsonOutput: boolean;
  /** Optional path to mirror JSONL events to a file (works in both TUI and --json-output modes). */
  jsonLogFile?: string;
  /** Enable manual testing phase passthrough for the inner loop. */
  manualTest: boolean;
  /** List mode: enable per-ticket diagnostics for --name <identifier>. */
  debug: boolean;
  /** Force-enable the pre-existing-error baseline gate (overrides config). */
  preExistingErrorCheck?: boolean;
  /** Disable tmux session management; run agent in the foreground directly. */
  noTmux: boolean;
  /** RLF-173 override: when defined, force pr-tracker on/off regardless of
   *  the `prTracker.enabled` workflow config. `--no-pr-tracker` sets false. */
  prTrackerEnabled?: boolean;
  /** List mode: show failing CI check names per PR. */
  checks: boolean;
}

// allow-duplicate
const VALID_MODES = new Set<string>(["agent", "list", "stop", "status"]);

const INDICATOR_KEYS = new Set<keyof Indicators>([
  "getTodo",
  "getInProgress",
  "getAutoMerge",
  "setInProgress",
  "setDone",
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
  "  --prompt <text>         Task description appended to every scaffolded proposal",
  "  --prompt-file <path>    Read prompt from file",
  "  --model <model>         Set model (haiku|sonnet|opus)",
  "  --claude [model]        Use Claude engine (haiku|sonnet|opus, default: opus)",
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
  "  --linear-assignee <id>  Filter by assignee (user id, email, or 'me')",
  "  --poll-interval <s>     Seconds between Linear polls (default: 60)",
  "  --concurrency <n>       Max concurrent task loops (default: 1)",
  "  --worktree              Run each task in its own git worktree",
  "  --indicator <k>:<t>:<v> Override an indicator (repeatable).",
  "                          Keys: getTodo, getInProgress, getAutoMerge,",
  "                                setInProgress, setDone, setError",
  "                          Types: label, status, attachment, project, comment",
  "                          --indicator setInProgress:attachment:In Progress",
  "                          (attachment upserts a single 'Ralphy' entry; value = subtitle)",
  "  --create-pr             Push the worker branch and open a GitHub PR on success (needs --worktree)",
  "  --fix-ci                After opening the PR, re-run on CI failures until green (needs --create-pr)",
  "  --stack-prs             Base the PR on a blocker issue's open-PR head branch when present (needs --create-pr)",
  "  --code-review           Watch open tracked PRs for unresolved review comments",
  "  --max-tickets <n>       Stop picking up new issues after N have been started (0 = unlimited)",
  "  --no-tmux               Disable tmux session management; run agent in the foreground directly",
  "  --no-pr-tracker         Disable RLF-173 pr-tracker bail / recovery counter for this run",
  "  --json-output           Emit JSONL to stdout instead of the Ink dashboard (for scripting/CI)",
  "                          (auto-enabled when stdin is not a TTY, e.g. pipes / nohup / CI)",
  "  --json-log-file <path>  Mirror JSONL events to a file (works alongside TUI or --json-output)",
  "  --pre-existing-error-check  Run baseline commands against the base branch; pause new pickups + open a Linear ticket when red",
  "  --checks                List mode: show failing CI check names per PR",
  "  --debug                 List mode: explain why a Linear ticket was not picked up (use with --name)",
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
  const common = initialCommonArgs();
  const result: AgentParsedArgs = {
    ...common,
    mode: "agent",
    linearTeam: "",
    linearAssignee: "",
    pollInterval: 0,
    concurrency: 0,
    worktree: false,
    indicators: {},
    createPr: false,
    fixCi: false,
    stackPrs: false,
    codeReview: false,
    maxTickets: 0,
    jsonOutput: false,
    manualTest: false,
    debug: false,
    noTmux: false,
    checks: false,
  };

  const state = emptyParseState();
  let expectLinearTeam = false;
  let expectLinearAssignee = false;
  let expectPollInterval = false;
  let expectConcurrency = false;
  let expectMaxTickets = false;
  let expectIndicator = false;
  let expectJsonLogFile = false;

  for (const arg of argv) {
    if (expectLinearTeam) {
      result.linearTeam = arg;
      expectLinearTeam = false;
      continue;
    }
    if (expectLinearAssignee) {
      result.linearAssignee = arg;
      expectLinearAssignee = false;
      continue;
    }
    if (expectPollInterval) {
      result.pollInterval = parseInt(arg, 10);
      expectPollInterval = false;
      continue;
    }
    if (expectConcurrency) {
      result.concurrency = parseInt(arg, 10);
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
      case "--worktree":
        result.worktree = true;
        break;
      case "--indicator":
        expectIndicator = true;
        break;
      case "--create-pr":
        result.createPr = true;
        break;
      case "--fix-ci":
        result.fixCi = true;
        break;
      case "--stack-prs":
        result.stackPrs = true;
        break;
      case "--code-review":
        result.codeReview = true;
        break;
      case "--json-output":
        result.jsonOutput = true;
        break;
      case "--json-log-file":
        expectJsonLogFile = true;
        break;
      case "--manual-test":
        result.manualTest = true;
        break;
      case "--checks":
        result.checks = true;
        break;
      case "--debug":
        result.debug = true;
        break;
      case "--pre-existing-error-check":
        result.preExistingErrorCheck = true;
        break;
      case "--no-tmux":
        result.noTmux = true;
        break;
      case "--no-pr-tracker":
        result.prTrackerEnabled = false;
        break;
      case "--pr-tracker":
        result.prTrackerEnabled = true;
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

  if (result.fixCi && !result.createPr) {
    throw new Error("--fix-ci requires --create-pr");
  }
  if (result.stackPrs && !result.createPr) {
    throw new Error("--stack-prs requires --create-pr");
  }

  return result;
}
