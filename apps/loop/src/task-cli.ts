import { log } from "@ralphy/output";
import { VERSION } from "@ralphy/version";
import { emptyCommonArgs } from "@ralphy/cli-args";
import {
  parseCommonArg,
  emptyParseState,
  resolvePromptFile,
  resolveWorkflowFile,
} from "@ralphy/cli-args/parse-common-args";
import type { LoopParsedArgs } from "./cli";
import type { TaskPhase } from "./loop";

/**
 * Task args are a superset of loop args: a single phase plus everything the
 * loop runner needs. Extending `LoopParsedArgs` lets `taskMain` hand the parsed
 * result straight to `App` without rebuilding a loop-args object by hand.
 */
interface TaskParsedArgs extends LoopParsedArgs {
  phase: TaskPhase;
}

const VALID_PHASES = new Set<string>(["research", "plan", "execute", "review"]);

const TASK_HELP_TEXT = [
  `ralphy task v${VERSION}`,
  "",
  "Usage: ralphy task <phase> [options]",
  "",
  "Phases:",
  "  research   Explore the codebase and write a research summary",
  "  plan       Produce proposal.md, design.md, and tasks.md artifacts",
  "  execute    Run the implementation loop (default loop behavior)",
  "  review     Audit the implementation against the spec",
  "",
  "Options:",
  "  --name <name>           Change name (required)",
  "  --workflow <path>       Path to an alternate WORKFLOW.md (default: <project>/WORKFLOW.md)",
  "  --prompt <text>         Task description",
  "  --prompt-file <path>    Read prompt from file",
  "  --model <model>         Set model (fable|opus|sonnet|haiku)",
  "  --claude [model]        Use Claude engine (fable|opus|sonnet|haiku)",
  "  --codex                 Use Codex engine",
  "  --delay <seconds>       Seconds between iterations",
  "  --max-iterations <n>    Stop after N iterations (0 = unlimited)",
  "  --max-cost <n>          Stop when total cost exceeds $N (0 = no limit)",
  "  --max-runtime <n>       Stop after N minutes of wall-clock time (0 = no limit)",
  "  --max-failures <n>      Stop after N consecutive failures (default: 5, 0 = disable)",
  "  --unlimited             No iteration limit",
  "  --log                   Log raw engine stream",
  "  --verbose               Verbose output",
  "  --help, -h              Show this help message",
  "",
  "Flags override WORKFLOW.md; unset flags fall back to its values, then to",
  "schema defaults (cli > workflow > default).",
  "",
  "Examples:",
  '  ralphy task execute --name my-feature --prompt "Add dark mode"',
  "  ralphy task plan --name my-feature --claude sonnet",
  "  ralphy task review --name my-feature",
].join("\n");

export function printTaskHelp(): void {
  log(TASK_HELP_TEXT);
}

export async function parseTaskArgs(argv: string[]): Promise<TaskParsedArgs> {
  const result: TaskParsedArgs = {
    ...emptyCommonArgs(),
    mode: "task",
    phase: "execute",
    review: {},
  };

  const state = emptyParseState();
  let phaseSet = false;

  for (const arg of argv) {
    if (parseCommonArg(arg, result, state)) continue;

    if (VALID_PHASES.has(arg)) {
      result.phase = arg as TaskPhase;
      phaseSet = true;
    } else {
      throw new Error(
        `Unknown argument: '${arg}'. Run 'ralphy task --help' for usage information.`,
      );
    }
  }

  await resolvePromptFile(result, state);
  resolveWorkflowFile(result, state);

  if (!phaseSet) {
    throw new Error(
      `Missing phase. Valid phases: research, plan, execute, review. Run 'ralphy task --help' for usage information.`,
    );
  }

  if (!result.name) {
    throw new Error("--name is required. Run 'ralphy task --help' for usage information.");
  }

  return result;
}
