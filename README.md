# Ralphy

[![npm version](https://img.shields.io/npm/v/@neriros/ralphy.svg)](https://www.npmjs.com/package/@neriros/ralphy)
[![npm downloads](https://img.shields.io/npm/dm/@neriros/ralphy.svg)](https://www.npmjs.com/package/@neriros/ralphy)
[![license](https://img.shields.io/npm/l/@neriros/ralphy.svg)](https://github.com/NeriRos/ralphy/blob/main/LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df.svg)](https://bun.sh)

An iterative AI task execution framework. Ralphy runs Claude or Codex in a checklist-driven loop with state on disk, cost safeguards, and a long-lived **agent** that polls Linear, opens PRs, and iterates with reviewers.

> 📘 Full reference — Linear indicators, lifecycle, PR/CI flow, CLI flags, MCP — lives in **[GUIDE.md](./GUIDE.md)**.

## Features

**Loop**

- **Checklist-driven** — one unchecked task per iteration; state persists on disk so any run can be resumed.
- **Engine choice** — Claude (haiku / sonnet / opus) or Codex, swappable per task.
- **Safeguards** — `--max-iterations`, `--max-cost`, `--max-runtime`, `--max-failures` cap any runaway run.
- **OpenSpec layout** — `proposal.md` (steering) + `design.md` + `tasks.md` + `specs/` per change.

**Agent mode (Linear-driven)**

- **Linear polling** — picks up Todo tickets, resumes In Progress, re-runs reviewer-flagged Done.
- **Indicators** — declarative `WORKFLOW.md` map for "which labels/statuses to watch and apply" at each lifecycle event.
- **Worktrees** — every task runs in its own `git worktree` so concurrent workers can't stomp on each other.
- **Confirmation gate** — optional human approval step between `tasks` and `implement`; revise via `@ralphy revise: <why>`.
- **Self-review phase** — once tasks are checked off, an in-process reviewer can append more work for another round.
- **Tmux session management** — `ralphy agent` re-execs into a managed tmux session so detaching the terminal doesn't kill the loop.
- **Pre-existing error check** — pauses pickups when the trunk is red so the agent doesn't chase failures it didn't cause.

**PR + CI**

- **Auto PR open** — push branch and `gh pr create` on clean exit; idempotent (surfaces existing PR if open).
- **Auto-merge opt-in** — `getAutoMerge` triggers `gh pr merge --auto --squash|merge|rebase` right after PR creation.
- **Stacked PRs** — `--stack-prs` opens against a blocker's head branch when a `blocked_by` Linear relation has exactly one open PR.
- **CI fix loop** — on red CI, pulls failed logs, appends to steering, re-spawns until green or `maxCiFixAttempts` hit.
- **Conflict re-fix** — `gh pr view`–driven; on `mergeable: CONFLICTING` enqueues a conflict-resolution task automatically.

**Reviewer interaction**

- **`@ralphy` mentions** — Linear comments _and_ GitHub PR comments trigger a fresh review run with the mention as the prompt.
- **Code-review iteration** — unresolved review-thread comments queue a digest; Ralph agrees-and-fixes (resolving the thread) or disagrees-and-replies.
- **Sticky task comment** — `tasks.md` mirrors into a single Linear comment that updates in place; a one-shot "📋 Plan" comment summarises proposal + design when planning completes.

**Observability**

- **Ink dashboard** — engine/model, poll-bucket breakdown, per-worker cards with live phase, command-in-flight, and stdout tail.
- **Structured JSON event stream** — `--json-output` for CI; `--json-log-file` mirrors the same stream to disk.
- **Per-worker logs** — `~/.ralph/agent-mode.log` (global) + `.ralph/logs/<change>.log` (per-task) + per-change `LOG.jsonl`.

**Extensibility**

- **MCP server** — exposes `ralph_list_changes` / `get_change` / `create_change` / `append_steering` / `stop` to Claude-side agents (auto-wired on per-project install).
- **`WORKFLOW.md` template body** — Jinja-style prompt rendered per iteration, so project-specific rules / boundaries / labels flow into every task automatically.

## How it works

```mermaid
graph LR
    S[Start iteration] --> R[Read Steering] --> T[First unchecked task] --> W[Do the work] --> V[Validate] --> C[Check off] --> S
    T -->|all checked| D[Archive change]
```

Each iteration reads `## Steering` from `proposal.md`, picks the first unchecked item in `tasks.md`, does the work, validates, and checks it off. When every item is checked the loop archives the change.

## Install

Requires [Bun](https://bun.sh). The Claude engine also needs the [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli).

```bash
npm install -g @neriros/ralphy   # or: bunx @neriros/ralphy
```

## Task mode — one-shot loop

```bash
ralphy loop task --name fix-auth --prompt "Fix the JWT validation bug" --claude opus --max-iterations 10

# Resume later (state is on disk)
ralphy loop task --name fix-auth

# Inspect
ralphy loop status --name fix-auth
```

Safeguards: `--max-iterations`, `--max-cost`, `--max-runtime`, `--max-failures`. Engine defaults to Claude Opus. See [GUIDE.md → CLI reference](./GUIDE.md#cli-reference) for the full set.

## Agent mode — Linear-driven

`ralphy agent` polls Linear, runs up to N concurrent task loops, and (optionally) opens PRs, watches CI, and iterates with reviewers. Requires `LINEAR_API_KEY`.

```bash
export LINEAR_API_KEY=lin_api_xxx
ralphy agent --linear-team ENG --linear-assignee me --concurrency 3 --create-pr --fix-ci
```

Each poll routes every matching issue into one of: **fresh** (Todo → scaffold + spawn), **resume** (In Progress → reattach), **conflict-fix** / **ci-fix** (PR red on GitHub → prepend fix task), or **review** / **code-review** (reviewer comments or `@ralphy` mention).

Configuration lives in **`WORKFLOW.md`** at the project root — YAML frontmatter for settings, followed by the Jinja-style prompt template the worker renders each iteration. A default is written on first run; CLI flags override per invocation.

See **[GUIDE.md](./GUIDE.md)** for:

- Lifecycle diagram + per-mode behavior
- `linear.indicators` schema and the full `WORKFLOW.md` example
- Confirmation gate (`@ralphy revise`, opt-in/out labels)
- `@ralphy` mentions, code-review iteration, self-review phase
- PR + CI integration (auto-merge, stacked PRs, fix-ci loop)
- Pre-existing error check, worktrees, tmux session management, dashboard, logs
- Complete CLI reference (task, agent, list modes)

## MCP server

Ralphy ships an MCP server (auto-configured on per-project install) exposing `ralph_list_changes`, `ralph_get_change`, `ralph_create_change`, `ralph_append_steering`, `ralph_stop`. See [GUIDE.md → MCP server](./GUIDE.md#mcp-server).

## Development

```bash
bun install
bunx nx run-many -t lint,typecheck,test,build   # all checks
bunx nx run cli:build                            # CLI only
```

Per-project install (builds + wires `.ralph/` and `.mcp.json` into the repo):

```bash
make install            # → ./.ralph
make install ~          # → ~/.ralph
make install /path/to   # → /path/to/.ralph
```
