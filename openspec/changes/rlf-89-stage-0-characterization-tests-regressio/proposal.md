# RLF-89: Stage 0 — Characterization tests (regression net)

Source: [RLF-89](https://linear.app/neriros/issue/RLF-89/stage-0-characterization-tests-regression-net)
Status: In Progress
Labels: ralph:auto-merge

## Why

Part of [RLF-87](https://linear.app/neriros/issue/RLF-87) — the agent is about to
be refactored into capabilities / detections / flows. Before any of that code
moves, we need a regression net that pins the **current observable behavior** of
`apps/agent/src/agent/wire.ts` + `apps/agent/src/agent/coordinator.ts` end‑to‑end
through `buildAgentCoordinator` → `coord.pollOnce()`.

The three "fails today" scenarios are deliberate: they encode the bugs that
Stage 2 is supposed to fix. By pinning them as expected‑failing tests now we

1. document the broken behavior precisely (gated ticket + PR conflict → wrong
   flow wins; gated ticket + CI failing → wrong flow wins; conflict‑fix
   re‑gates instead of preserving approval),
2. give Stage 2 a measurable acceptance signal — those three tests must flip
   from red to green without any of the green tests regressing,
3. lock the surface area so the refactor cannot silently change behavior on
   any of the already‑green paths (new‑ticket → approval → implement, revise →
   design loop, round‑cap exhaustion, finished + conflicting PR promotion, JSON
   log + PostHog telemetry stream).

This change is **tests only**. No production code changes. CI must stay green
at the boundary (the three "fails today" tests run in a quarantined mode that
expects failure — see design.md).

## What Changes

- Add an integration test file `apps/agent/src/__tests__/agent-characterization.test.ts`
  that drives the real `buildAgentCoordinator` pipeline (only Linear API, git,
  gh, worker spawn, and shell scripts are faked — same fake harness as
  `agent-integration.test.ts`).
- Add seven scenario tests covering the full poll life‑cycle: four green
  scenarios (new‑ticket happy path, revise → design loop, round‑cap
  exhaustion, finished + conflicting PR → conflict promotion), and three
  scenarios that fail today and are pinned as expected‑failing (gated +
  PR‑conflict winner, gated + CI‑failing winner, approval persistence across
  conflict‑fix reset). Expected‑failing tests are registered with Bun's
  `test.failing` so CI passes today and Stage 2 can flip them by removing the
  `.failing` marker.
- Add a golden‑file fixture for the `--json-output` event stream of a full
  new‑ticket → done run, plus a recorded helper that diff‑prints when the
  golden drifts (`apps/agent/src/__tests__/__golden__/json-output-new-ticket.jsonl`).
- Add a golden‑file fixture for the PostHog events captured across the same
  run (`apps/agent/src/__tests__/__golden__/posthog-new-ticket.jsonl`),
  asserted via the existing telemetry capture seam.
- Add a spec delta `specs/agent-characterization-tests/spec.md` documenting
  the requirement that these characterization tests exist and the policy for
  the three expected‑failing markers (Stage 2 owns flipping them).
- No production source file is modified. No coverage threshold is reduced.

## Linear comments

**Neriya Rosner** — 2026-05-20T18:43:51.824Z
✗ Ralph exited with code 143 on this issue. Change: `rlf-89-stage-0-characterization-tests-regressio`

This issue has been quarantined and will not be auto-resumed on the next poll. Inspect the worktree at `~/.ralph/<project>/worktrees/rlf-89-stage-0-characterization-tests-regressio`, fix the underlying failure, then remove the error marker on this Linear issue (or run `ralph clean --name rlf-89-stage-0-characterization-tests-regressio`) to clear the quarantine.

**Neriya Rosner** — 2026-05-20T18:40:19.717Z

<!-- ralphy:tasks:start -->

### Ralph progress

_No mission tasks yet — planning in progress._

<sub>`rlf-89-stage-0-characterization-tests-regressio` · iteration 0</sub>

<!-- ralphy:tasks:end -->

**Neriya Rosner** — 2026-05-20T18:40:19.520Z
🤖 Ralph started working on this issue. Tracking change: `rlf-89-stage-0-characterization-tests-regressio`

## Additional instructions

You are working on RLF-89: Stage 0 — Characterization tests (regression net).

Part of [RLF-87](https://linear.app/neriros/issue/RLF-87) — refactor agent into capabilities / detections / flows.

**Effort:** S (1–2d)

**Goal:** Pin current behavior with integration tests against `wire.ts` + `coordinator.ts`. The three "fails today" tests are the headline acceptance for stage 2.

**Merge order:** This stage must merge before Stage 1. CI must be green at every boundary.

Labels: ralph:auto-merge

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
