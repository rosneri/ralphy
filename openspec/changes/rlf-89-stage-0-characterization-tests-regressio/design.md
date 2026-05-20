# Design for RLF-89 — Characterization tests

## Goals

1. Pin observable behavior of `buildAgentCoordinator` + `coord.pollOnce()` for
   the seven scenarios in proposal.md, with the three known bugs encoded as
   `test.failing` so CI stays green now and Stage 2 can flip them by deleting
   the `.failing` marker.
2. Record two golden fixtures (`--json-output` and PostHog) for a happy-path
   run so any later refactor that drifts the event stream is caught.
3. Do not touch production source. No coverage threshold change.

## Files

### New

- `apps/agent/src/__tests__/agent-characterization.test.ts` — the seven
  scenarios + the two golden assertions.
- `apps/agent/src/__tests__/helpers/characterization-harness.ts` — shared
  fake-harness wrapper around the existing `agent-integration.test.ts`
  fakes (FakeLinear, fake `GitRunner`, fake `CmdRunner`, fake
  `spawnWorker`, fake `runScript`). Extracted only if the test file would
  otherwise exceed ~600 lines; otherwise inlined.
- `apps/agent/src/__tests__/__golden__/json-output-new-ticket.jsonl` —
  golden for the JSON event stream of the happy path.
- `apps/agent/src/__tests__/__golden__/posthog-new-ticket.jsonl` — golden
  for the PostHog capture stream of the happy path.

### Touched (test only)

- None outside `apps/agent/src/__tests__/`.

## Test harness

Reuse the existing harness in `apps/agent/src/__tests__/agent-integration.test.ts`:

- `FakeLinear` (in-memory issues + comments + label/state mutations).
- Fake `GitRunner` that records git commands and answers `rev-parse` /
  `worktree list` / `status` synthetically.
- Fake `CmdRunner` for gh and generic shell; PR status (`mergeable` /
  `conflicted` / `ci_failed` / `unknown`) is returned per-issue from a map
  the test seeds.
- Fake `spawnWorker` that immediately resolves with a configurable exit
  code so each scenario controls "what the worker did" without launching a
  real subprocess.
- Fake `runScript` that records script invocations.

If extraction is required, the harness module exports a single
`buildCharacterizationCoord(options)` returning `{ coord, linear, runners,
recorders }`.

## Scenario design

Each scenario follows the same skeleton:

```
1. Build a temp project root with openspec/changes + .ralph/tasks scaffolding.
2. Seed FakeLinear with one issue in the relevant bucket
   (todo/inProgress/conflicted/review/doneCandidate).
3. Seed PR conflict map + tasks.md state to match the scenario's "world".
4. Build the coordinator via buildAgentCoordinator(realCoordDeps).
5. Call coord.pollOnce() — possibly multiple times where the scenario walks
   through `approval → implement → done` across polls.
6. Assert:
   - which spawn modes were issued (gate / implement / conflict-fix / ci-fix
     / resume) and against which issue ids,
   - which label/state mutations FakeLinear saw,
   - which comments were posted,
   - that tasks.md was rewritten as expected (for scenarios that touch it),
   - the order of telemetry events (for the two golden scenarios).
```

### Green scenarios (regular `test(...)`)

| #   | Name                                                | Key assertion                                                                                                                               |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | new ticket → approval → implement → done            | gate spawn → approval label → implement spawn → done state. Captures the full JSON + PostHog goldens.                                       |
| 2   | new ticket → revise → design → approval → implement | revise on the proposal triggers a design re-loop and a fresh gate before implement.                                                         |
| 6   | round-cap exhaustion → stuck                        | after N consecutive identical worker failures the issue is moved to `stuck` and no further spawn is issued in the same poll.                |
| 7   | finished + PR conflicting → conflict-fix            | already covered by `agent-conflict-promotion` spec; this test is the cross-stage anchor that promotion still works after Stage 2 refactors. |

### "Fails today" scenarios (`test.failing(...)`)

| #   | Name                                                           | Bug being pinned                                                                                           |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 3   | gated ticket + PR conflicted → conflict-fix wins               | Today the gate wins over conflict-fix; correct behavior is conflict-fix priority.                          |
| 4   | gated ticket + CI failing → ci-fix wins                        | Symmetric: gate wins today; correct is ci-fix priority.                                                    |
| 5   | approval persisted + tasks reset for conflict-fix → no re-gate | Today the conflict-fix flow resets tasks and re-gates the user; correct is to preserve the prior approval. |

Each `test.failing` body MUST contain the same assertion the green version
will use in Stage 2, so flipping `.failing` → plain `test` is the only edit
needed. We are NOT asserting "wrong behavior"; we are asserting the right
behavior and accepting that it throws today.

## Goldens

### `json-output-new-ticket.jsonl`

Emitted by routing the coordinator through the same JSON event sink used by
the `--json-output` CLI flag. The sink is captured via the existing
`json-runner` seam in tests (see `apps/agent/src/__tests__/json-runner-log-file.test.ts`).

### `posthog-new-ticket.jsonl`

PostHog `capture()` calls are recorded through the telemetry client seam
(the coordinator already takes an injected telemetry client; tests pass a
fake recorder).

### Normalisation

Before diffing against the golden, the captured stream is run through a
small normaliser that replaces:

- ISO timestamps → `"<TIMESTAMP>"`
- absolute paths under `tempDir` → `"<TMPDIR>"`
- numeric durations / `ms` fields → `"<DURATION>"`
- pids and random ids → `"<ID>"`

### Update workflow

When the JSON or PostHog shape intentionally changes, the developer runs:

```
UPDATE_GOLDEN=1 bun --cwd apps/agent test agent-characterization
```

which rewrites both golden files with the freshly captured + normalised
stream. The check-in of the new golden is the audit trail for the
intentional shape change.

## Edge cases

- **Bun test discovery**: confirm `test.failing` is supported by the
  installed Bun version. If not, fall back to wrapping the assertion in
  `expect(...).toThrow()` with a `// stage-2: remove this wrapper` comment.
  Stage 2 still has a one-line edit.
- **Non-determinism in poll order**: every scenario MUST seed the issue
  buckets in the order the production code reads them; assertions about
  spawn order MUST be tolerant of stable insertion order only.
- **Golden churn from poll loop idle calls**: the JSON sink emits
  `poll_start`/`poll_end` regardless. The golden includes these — they
  are part of the contract.
- **Coverage threshold**: tests-only change, so coverage cannot regress on
  net. Verify with `bun run test --coverage` locally before pushing.

## Out of scope

- Any behavior change in `wire.ts` or `coordinator.ts` — that is Stage 2.
- Refactoring the existing `agent-integration.test.ts`.
- Adding tests for capabilities/detections modules that do not yet exist.
