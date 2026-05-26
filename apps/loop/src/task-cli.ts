import { log } from "@ralphy/output";
import { VERSION } from "@ralphy/version";
import {
  initialCommonArgs,
  parseCommonArg,
  emptyParseState,
  type CommonArgs,
} from "@ralphy/cli-args";
import type { TaskPhase } from "./loop";

interface TaskParsedArgs extends CommonArgs {
  phase: TaskPhase;
  name: string;
  prompt: string;
  fromAgent: boolean;
}

const VALID_PHASES = new Set<string>(["research", "plan", "execute", "review"]);

// allow-duplicate
const HELP_TEXT = [
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
  "  --prompt <text>         Task description",
  "  --prompt-file <path>    Read prompt from file",
  "  --model <model>         Set model (haiku|sonnet|opus)",
  "  --claude [model]        Use Claude engine (haiku|sonnet|opus, default: opus)",
  "  --codex                 Use Codex engine",
  "  --delay <seconds>       Seconds between iterations",
  "  --max-iterations <n>    Stop after N iterations (0 = unlimited)",
  "  --max-cost <n>          Stop when total cost exceeds $N (0 = no limit)",
  "  --max-runtime <n>       Stop after N minutes of wall-clock time (0 = no limit)",
  "  --max-failures <n>      Stop after N consecutive failures (default: 5, 0 = disable)",
  "  --unlimited             No iteration limit (default)",
  "  --log                   Log raw engine stream",
  "  --verbose               Verbose output",
  "  --help, -h              Show this help message",
  "",
  "Examples:",
  '  ralphy task execute --name my-feature --prompt "Add dark mode"',
  "  ralphy task plan --name my-feature --claude sonnet",
  "  ralphy task review --name my-feature",
].join("\n");

export function printTaskHelp(): void {
  log(HELP_TEXT);
}

export async function parseTaskArgs(argv: string[]): Promise<TaskParsedArgs> {
  const common = initialCommonArgs();
  const result: TaskParsedArgs = {
    ...common,
    phase: "execute",
    name: "",
    prompt: "",
    fromAgent: false,
  };

  const state = emptyParseState();
  let expectName = false;
  let expectPrompt = false;
  let expectPromptFile = false;
  let phaseSet = false;

  for (const arg of argv) {
    if (expectName) {
      result.name = arg;
      expectName = false;
      continue;
    }
    if (expectPrompt) {
      result.prompt = arg;
      expectPrompt = false;
      continue;
    }
    if (expectPromptFile) {
      result.prompt = await Bun.file(arg).text();
      expectPromptFile = false;
      continue;
    }

    if (parseCommonArg(arg, result, state)) continue;

    switch (arg) {
      case "--name":
        expectName = true;
        break;
      case "--prompt":
        expectPrompt = true;
        break;
      case "--prompt-file":
        expectPromptFile = true;
        break;
      case "--from-agent":
        result.fromAgent = true;
        break;
      default:
        if (VALID_PHASES.has(arg)) {
          result.phase = arg as TaskPhase;
          phaseSet = true;
        } else {
          throw new Error(
            `Unknown argument: '${arg}'. Run 'ralphy task --help' for usage information.`,
          );
        }
        break;
    }
  }

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
