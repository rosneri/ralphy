# Design for RLF-141: Make the first five Moments very short

## Files touched

- `packages/core/src/loop.ts` — `buildTaskPrompt`: add auto-verbosity block for `state.iteration < 5`
- `packages/core/src/__tests__/loop.test.ts` — new test suite for the auto-verbosity behavior

## Data flow

1. Loop calls `buildTaskPrompt(currentState, tasksDir)` at the start of each iteration.
2. `currentState.iteration` is 0 before the first run, 1 after the first completes, etc.
3. When `state.iteration < AUTO_VERBOSITY_MOMENTS (5)`, a "Verbosity: VERY SHORT" block is prepended.
4. The prompt is passed unchanged to `runEngine`, which forwards it to Claude CLI via stdin.
5. Claude reads the verbosity block first and constrains its response accordingly.

## Prompt structure (moments 1–5)

```
---
# Verbosity: VERY SHORT (Moment N/5)

This is warm-up moment N of 5. Keep your response very short — ...

---

[optional: User Steering block]
[Current Task Section or Initial Prompt]
[optional: Manual Testing Phase]
Change name: `...`
...
```

## Prompt structure (moment 6+)

No verbosity block; identical to pre-feature behavior.

## Edge cases

- `state.iteration` persists across worker respawns: a change that was interrupted at iteration 3 and respawned still sees moment 4 on its next run. This is correct — the moment count is cumulative.
- When `AUTO_VERBOSITY_MOMENTS` needs tuning in the future, one constant in `loop.ts` controls all behavior.
- No backward compatibility concern: the new block only adds text to the prompt, nothing is removed.

## Constants

```typescript
const AUTO_VERBOSITY_MOMENTS = 5;
```
