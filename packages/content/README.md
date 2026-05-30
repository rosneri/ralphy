# Ralph

Iterative AI task execution framework. This directory was created by `make install` from [ralphy](https://github.com/rosneri/ralphy).

## Quick Start

```bash
# Create and run a task (10 iterations max)
ralph task --name my-task --prompt "Description of what to do" --claude opus 10

# Interactive mode — guide research + plan, then automate
ralph task --name my-task --prompt "Description of what to do" --interactive

# Resume an existing task
ralph task --name my-task

# List all tasks
ralph list

# Check a task's status
ralph status --name my-task
```

## Commands

| Command                                  | Description             |
| ---------------------------------------- | ----------------------- |
| `ralph task --name <n> --prompt <p>`     | Create and run a task   |
| `ralph task --name <n>`                  | Resume an existing task |
| `ralph list`                             | Show all tasks          |
| `ralph status --name <n>`                | Detailed task status    |
| `ralph advance --name <n>`               | Advance to next phase   |
| `ralph set-phase --name <n> --phase <p>` | Set a specific phase    |

## Options

| Option               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `--claude [model]`   | Use Claude engine (haiku/sonnet/opus)            |
| `--codex`            | Use Codex engine                                 |
| `--no-execute`       | Stop after research + plan                       |
| `--interactive`      | Run research + plan interactively, then automate |
| `--max-cost <N>`     | Stop when cost exceeds $N                        |
| `--max-runtime <N>`  | Stop after N minutes                             |
| `--max-failures <N>` | Stop after N consecutive failures (default: 5)   |
| `--delay <N>`        | Seconds between iterations                       |

## Phases

**Research** → **Plan** → **Exec** ⇄ **Review** → **Done**

Each task progresses through these phases automatically. The review phase loops back to exec if issues are found.

## Directory Structure

```
.ralph/
├── bin/
│   ├── cli.js         # CLI entrypoint
│   └── mcp.js         # MCP server
├── phases/            # Phase definitions
├── templates/         # Scaffolds and checklists
└── tasks/             # Your tasks live here
    └── <task-name>/
        ├── state.json      # Task state and history
        ├── STEERING.md     # Your guidance (edit anytime)
        ├── RESEARCH.md     # Agent's research
        ├── PLAN.md         # Agent's plan
        ├── PROGRESS.md     # Execution checklist
        └── INTERACTIVE.md  # Context from interactive session
```

## Steering

Edit `tasks/<name>/STEERING.md` to guide the agent while it runs. Changes are picked up on the next iteration.

## Stopping a Task

- Set `--max-cost`, `--max-runtime`, or a max iteration count
- Create a `STOP` file in the task directory: `echo "reason" > .ralph/tasks/<name>/STOP`
