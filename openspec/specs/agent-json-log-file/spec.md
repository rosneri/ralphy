# agent-json-log-file Specification

## Purpose

TBD - created by archiving change rlf-86-add-cli-parameter-for-json-file-logging. Update Purpose after archive.

## Requirements

### Requirement: The agent CLI MUST accept a `--json-log-file <path>` flag that captures the event stream as JSONL

The agent app (`apps/agent`) MUST add a new optional CLI flag,
`--json-log-file <path>`. When provided, the agent MUST append every
coordinator/worker event that `--json-output` already emits to the given
file path, encoded as one JSON object per line (JSONL). Each line MUST
carry the same `ts` epoch-millisecond field and the same `type` discriminator
that the stdout JSONL stream uses.

The flag MUST work in both run modes:

- TUI mode (default Ink dashboard): file logging runs alongside the
  interactive UI; stdout is untouched.
- `--json-output` mode: the same event objects are written to both
  stdout and the file.

The agent MUST create the parent directory of `<path>` if it does not
exist. The agent MUST truncate or create the file at startup so each
run owns its log. After startup, writes are append-only. Write failures
MUST be best-effort: a failed write to the log file MUST NOT crash the
coordinator or any worker; it MUST be ignored (matching the behaviour
of the existing `~/.ralph/agent-mode.log` writer).

When `--json-log-file` is omitted, behaviour is identical to today —
no file is created and no extra writes happen.

`ParsedArgs.jsonLogFile?: string` MUST be exposed on the agent CLI's
parsed-args type, and the help text MUST list the new flag.

#### Scenario: TUI mode with `--json-log-file` writes events to the file

- **Given** the agent is started in default (TUI) mode with
  `--json-log-file /tmp/agent.jsonl`
- **When** the coordinator emits a `poll_done` event and a worker
  emits a `worker_started` event
- **Then** `/tmp/agent.jsonl` contains exactly two appended lines
- **And** each line parses as JSON
- **And** the first line has `type === "poll_done"` and the second
  `type === "worker_started"`
- **And** both lines carry a numeric `ts` field

#### Scenario: `--json-output` together with `--json-log-file` writes the same events to both sinks

- **Given** the agent is started with both `--json-output` and
  `--json-log-file /tmp/agent.jsonl`
- **When** the coordinator emits any event
- **Then** the event appears once on stdout as JSONL
- **And** the same event (identical `type` and payload) appears once
  in `/tmp/agent.jsonl`

#### Scenario: omitting `--json-log-file` produces no file

- **Given** the agent is started without `--json-log-file`
- **When** the coordinator runs for one poll cycle
- **Then** no new file is created at any path derived from the flag
- **And** stdout / TUI behaviour is unchanged from today

#### Scenario: startup truncates a stale log file

- **Given** `/tmp/agent.jsonl` already exists with content from a
  previous run
- **When** the agent starts with `--json-log-file /tmp/agent.jsonl`
- **Then** the previous content is removed before the first event is
  written
- **And** only events from the new run remain in the file

#### Scenario: a failing write to the log file does not crash the agent

- **Given** `--json-log-file` points at a path whose parent directory
  becomes unwritable after startup (e.g. permissions revoked, disk
  full)
- **When** the coordinator emits an event
- **Then** the agent continues running
- **And** the failure is swallowed (no uncaught exception, no
  `process.exit`)
