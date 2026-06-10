# RLF-153: JSON log file missing lines

Source: [RLF-153](https://linear.app/neriros/issue/RLF-153/json-log-file-missing-lines)
Status: Done
Assignee: Neriya Rosner
Labels: Bug

## Why

`logJsonEvent` in `packages/log/src/log.ts` delegates to a fire-and-forget `appendFile` with no per-file serialization. When `broadcast()` in the UI sidecar fires many events in rapid succession (e.g. during a feed event stream), these concurrent `appendFile` calls race each other. For writes larger than `PIPE_BUF`, bytes from different calls can interleave, and errors are silently swallowed — both resulting in missing or corrupt lines in the `.jsonl` log. The agent's own `createJsonLogFileSink` (in `apps/agent/src/agent/json-log/json-log-file.ts`) already solves this with a per-file promise chain; the `@ralphy/log` package needs the same treatment.

## What Changes

- Add a per-path promise-chain map inside `packages/log/src/log.ts` so that all `logJsonEvent` writes to the same path are serialized, exactly mirroring the approach in `json-log-file.ts`.
- Add a `flushJsonLog(path)` helper that returns a promise resolving when all queued writes for a given path are complete (used for tests and graceful shutdown).
- Update the existing `write()` helper to remain fire-and-forget for non-JSON log uses; only `logJsonEvent` gets the serialized chain.

## Additional instructions

You are working on RLF-153: JSON log file missing lines.

The json log file doesn't record all lines I only see some lines, it should always append new lines

Labels: Bug

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
