# Design for RLF-34

## 1. Scaffolded proposal must satisfy `openspec validate`

### Current state

`apps/agent/src/agent/scaffold.ts` writes `proposal.md` with this header set:

```
# <ID>: <title>
Source: …
Status: …
## Description
## Linear comments     (optional)
## Additional instructions  (optional)
## Steering
```

`bunx openspec validate <change>` requires `## Why` and `## What Changes` at the top level. The
omission causes a validation warning on the first iteration of every change.

### Change

Update the proposal template in `scaffoldChangeForIssue` to:

```
# <ID>: <title>
Source: …
Status: …
Assignee: …
Labels: …

## Why

<Linear description, or "_Fill in the motivation for this change._" placeholder>

## What Changes

_Fill in the concrete changes this proposal makes. Use bullet points._

## Description

<original description block, unchanged — keeps existing tests/prompts working>

…
## Steering
```

`## Why` is seeded with the Linear description so the validator's structural check passes
immediately, while leaving the existing `## Description` block intact (so other tooling and
existing scaffold tests continue to work). `## What Changes` is seeded with a single placeholder
italic line so `isStubArtifact` still recognises an unfilled proposal as a stub.

### Files

- `apps/agent/src/agent/scaffold.ts` — template change.
- `apps/agent/src/__tests__/agent.test.ts` — new assertions for the two new headers.

### Planning task copy

`tasks.md` planning checklist (also in `scaffold.ts`) gains an explicit reminder to fill in
`## Why` / `## What Changes` and to add at least one spec delta under `specs/<capability>/spec.md`
so `openspec validate` runs clean before each commit.

## 2. Triple completion banner

### Current rendering pipeline

`apps/loop/src/components/TaskLoop.tsx` renders:

```
<Static items={[banner, …logLines]}>…</Static>
{loop.isRunning  && <StatusBar running />}{<SteerInput />}
{loop.stopReason && <StatusBar stopped />}<StopMessage … />
```

`useLoop` finishes a change as follows (current order):

```
setStopReason("completed");
break;
// after the while loop:
ensureState; capture(...);
addInfo("Ralph loop finished after N iterations.");   // ← Static grows
commitTaskDir(...); gitPush();                         // sync work
setIsRunning(false);
```

Each `addInfo` flushes a new `<Static>` line. Ink redraws the dynamic block (which already
contains `StopMessage`) below the newly-committed static line. When the terminal scrolls, the
previous dynamic frame is left in the scrollback as a ghost copy. The three appearances of
`All tasks completed — change archived.` correspond to:

1. Initial render after `setStopReason("completed")`.
2. After `addInfo("Ralph loop finished after …")` — Static grows, dynamic redrawn below.
3. After `setIsRunning(false)` — final dynamic frame committed at exit.

### Fix

Two coordinated edits in `apps/loop/src/hooks/useLoop.ts` and `apps/loop/src/components/TaskLoop.tsx`:

1. **Move `setStopReason` to the very end of the effect**, after all `addInfo`, `commitTaskDir`,
   and `gitPush` work. Track the reason in a local `finalStopReason` (already exists) and call
   `setStopReason(finalStopReason)` immediately before `setIsRunning(false)`. This ensures no
   `<Static>` items are appended _after_ the dynamic stop block first renders.
2. **Render the stop block only when `!loop.isRunning`** in `TaskLoop.tsx`. The dynamic stop
   section is then rendered exactly once — at the final frame — and Ink commits it once to
   stdout on exit. Removes the in-between intermediate render where both `isRunning` and
   `stopReason` were briefly true together.

### Edge cases

- **Engine error path** (`catch` branch around `runEngine`) currently `break`s without setting
  `stopReason`. That path still works: `setIsRunning(false)` fires at the end of the effect with
  `finalStopReason === null`, so no stop block renders, and the existing `addInfo("Engine
error: …")` static line is the visible final state.
- **STOP signal path** (`checkStopSignal` returns non-null) also breaks without setting a
  `stopReason`. Same as the engine error path — no change in observable behavior.
- **Resume path** is unaffected; only the _final_ render order changes.

### Files

- `apps/loop/src/hooks/useLoop.ts` — reorder `setStopReason` to the bottom of the effect.
- `apps/loop/src/components/TaskLoop.tsx` — render stop block only when `!loop.isRunning`.
- `apps/loop/src/__tests__/components.test.tsx` (or a new `useLoop` test) — regression test for
  the "no `StopMessage` while running" invariant.
