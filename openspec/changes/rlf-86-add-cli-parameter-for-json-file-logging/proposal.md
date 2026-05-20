# RLF-86: Add CLI parameter for JSON file logging

Source: [RLF-86](https://linear.app/neriros/issue/RLF-86/add-cli-parameter-for-json-file-logging)
Status: In Review

## Why

Add a new CLI parameter to write logs (all logs we currently have + json output) as JSONL to a file in addition to the TUI output.

## What Changes

- Add a new agent CLI flag `--json-log-file <path>` that, when set, appends every coordinator/worker event (the same events emitted by `--json-output`: `started`, `log`, `poll_start`, `poll_done`, `worker_started`, `worker_exited`, `worker_phase`, `worker_output`, `worker_cmd_start`, `worker_cmd_end`, `worker_pr`, `awaiting_confirmation`, `stopped`, `error`) as one JSON object per line to the given file.
- The flag is independent of `--json-output`: it works whether the agent is running the Ink TUI or the JSON stdout mode. Both can be on at the same time; the file receives the same events that go to stdout.
- The parent directory is created if needed; the file is truncated at startup so each run owns its log. Writes are append-only after that and best-effort (a failing write must not crash the loop).
- `ParsedArgs.jsonLogFile?: string` is added to the agent CLI types, the help text gets a one-line entry, and the new flag is parsed in the existing `parseArgs` switch.
- The TUI path (`AgentMode`) and the JSON path (`runAgentJson`) both wire a tiny `emitJsonLog` helper alongside their existing callbacks so each event reaches the file exactly once.

## Acceptance Criteria

- `ralph agent --json-log-file <path>` writes valid JSONL with one event per line for every event emitted during a run.
- The same events appear both on stdout and in the file when `--json-output` and `--json-log-file` are combined.
- Omitting `--json-log-file` keeps behavior identical to today.
- `bun run lint` and `bun run test` pass.

## Linear comments

**Neriya Rosner** — 2026-05-20T15:54:49.907Z
✅ Ralph completed work on this issue. Change: `rlf-86-add-cli-parameter-for-json-file-logging`
**Neriya Rosner** — 2026-05-20T15:54:46.526Z
🔁 Ralphy: revise request acknowledged — restarting at design (round 1/3).
**Neriya Rosner** — 2026-05-20T15:54:45.767Z
📋 Ralphy plan ready for `rlf-86-add-cli-parameter-for-json-file-logging` — review proposal.md / design.md / tasks.md and approve to continue, or reply with `@ralphy revise: <reason>` to send it back to design.
**Neriya Rosner** — 2026-05-20T15:49:07.908Z

### 📋 Ralph plan — `rlf-86-add-cli-parameter-for-json-file-logging`

**Why**

Today the agent app has two output modes: the Ink TUI (interactive) and
`--json-output` (machine-readable JSONL on stdout). Operators who run the
TUI for visibility cannot also capture a machine-readable record of what
happened — the only persisted artifact is `~/.ralph/agent-mode.log`,
which is plain text and not parseable for diagnostics, dashboards, or
post-hoc analysis.

We need a way to capture the same structured event stream that
`--json-output` emits, but **to a file**, while the operator continues to
watch the TUI (or while `--json-output` is also active).

**What Changes**

- Add a new agent CLI flag `--json-log-file <path>` that, when set,
  appends every coordinator/worker event (the same events emitted by
  `--json-output`: `started`, `log`, `poll_start`, `poll_done`,
  `worker_started`, `worker_exited`, `worker_phase`, `worker_output`,
  `worker_cmd_start`, `worker_cmd_end`, `worker_pr`,
  `awaiting_confirmation`, `stopped`, `error`) as one JSON object per
  line to the given file.
- The flag is independent of `--json-output`: it works whether the
  agent is running the Ink TUI or the JSON stdout mode. Both can be on
  at the same time; the file receives the same events that go to stdout.
- The parent directory is created if needed; the file is truncated at
  startup so each run owns its log. Writes are append-only after that
  and best-effort (a failing write must not crash the loop).
- `ParsedArgs.jsonLogFile?: string` is added to the agent CLI types,
  the help text gets a one-line entry, and the new flag is parsed in
  the existing `parseArgs` switch.
- The TUI path (`AgentMode`) and the JSON path (`runAgentJson`) both
  wire a tiny `emitJsonLog` helper alongside their existing callbacks
  so each event reaches the file exactly once.

**Design**

## Goal

**Neriya Rosner** — 2026-05-20T15:44:11.654Z

<!-- ralphy:tasks:start -->

### Ralph progress

_No mission tasks yet — planning in progress._

<sub>`rlf-86-add-cli-parameter-for-json-file-logging` · iteration 0</sub>

<!-- ralphy:tasks:end -->

**Neriya Rosner** — 2026-05-20T15:44:11.411Z
🤖 Ralph started working on this issue. Tracking change: `rlf-86-add-cli-parameter-for-json-file-logging`

## Additional instructions

You are working on RLF-86: Add CLI parameter for JSON file logging.

Add a new CLI parameter to write logs (all logs we currently have + json output) as JSONL to a file in addition to the TUI output.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

- 2026-05-20: Linear @ralphy mention on the issue is the automated "plan ready, awaiting approval" notification (no concrete revise/instruction in the message body). Interpretation: nothing to act on — the plan stays as-is awaiting human approval or a `@ralphy revise: <reason>` reply. Acknowledged and ticked the agent-task; not modifying proposal/design/specs in response.
- 2026-05-20 (16:13Z, round 2): Second identical plan-ready @ralphy mention picked up after the implementation already shipped on this branch (PR #216 open with commits dfcb857..d0b247b). No concrete revise text in the body — only the literal template `@ralphy revise: <reason>` example. Interpretation: still nothing to act on; plan and implementation remain as-is awaiting human approval. Acknowledging and ticking the agent-task without further edits.
