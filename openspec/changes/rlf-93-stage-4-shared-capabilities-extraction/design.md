# Design for RLF-93 — Stage 4: Shared capabilities extraction

## Target layout

```
apps/agent/src/shared/capabilities/
  index.ts              # re-exports + runCapability shell
  types.ts              # Capability<TArgs,TResult>, RetryPolicy, ErrorFormatter
  run-capability.ts     # shell: retry loop, error formatter, bus emit, adopt
  linear-client.ts      # GraphQL transport + every Linear op as a Capability
  gh-client.ts          # gh CLI wrappers (pr view, pr create, pr checks, ...)
  git.ts                # worktree create/remove, fetch, branch list
  fs-change.ts          # change-dir writes: scaffold, prependTask, append steering
  worker-spawner.ts     # one spawnWorker({ cwd, changeName, steeringNote?, prependTask? })
  poll-context.ts       # per-poll memo (was apps/agent/src/agent/poll-context)
  __tests__/...
```

## Capability contract

```ts
export interface RetryPolicy {
  maxAttempts: number;                                  // default 1 = no retry
  isRetryable: (err: unknown) => boolean;
  delayMs: (attempt: number, err: unknown) => number;   // honors Retry-After when supplied
}

export type ErrorFormatter = (err: unknown) => string;

export interface Capability<TArgs, TResult> {
  name: string;                  // e.g. "linear.tickets.fetch"
  required: boolean;             // if true, a thrown error is fatal — never returns a value
  retryPolicy: RetryPolicy;
  errorFormatter: ErrorFormatter;
  adopt?: (raw: unknown) => TResult; // optional shape-narrowing on external payload
  run: (args: TArgs) => Promise<TResult>;
}

export async function runCapability<A, R>(
  cap: Capability<A, R>,
  args: A,
  ctx: { bus?: Bus }
): Promise<R> { ... }
```

`runCapability` responsibilities, in order:

1. Emit `${cap.name}.started` on the bus.
2. Attempt `cap.run(args)` up to `cap.retryPolicy.maxAttempts` times.
3. On thrown error: format with `cap.errorFormatter`, emit `${cap.name}.failed { error }`.
4. If `cap.required` and error thrown, rethrow — **no fallback return value is ever produced**. This is the construct-level RLF-39 guarantee.
5. On success: optionally pipe through `cap.adopt`, emit `${cap.name}.fetched { count? }`, return.

## Event names (added to `@ralphy/events`)

A new tagged subset is added to `RalphEvent`:

- `linear.tickets.fetched` / `linear.comment.posted` / `linear.label.applied`
- `gh.pr.fetched` / `gh.pr.checks.fetched` / `gh.pr.created`
- `git.worktree.created` / `git.worktree.removed`
- `fs.change.scaffolded` / `fs.change.task.prepended` / `fs.change.steering.appended`
- `worker.spawned` (replaces `agent_worker_spawned`; old name kept as alias one cycle)
- Each may also be paired with `*.failed { error }` for failure paths.

Field shape: `{ type, ts, capability: string, operation: string, [args summary] }`. No raw payloads.

## Worker mode removal

- `SpawnMode` deleted from `apps/agent/src/queue/queue-order.ts`.
- `QueueItem` gains `priority: number` (lower = first). Today's mode ranking (`resume(0) < conflict-fix(1) < review(2) < fresh(3)`) becomes that explicit number, computed where the item enters the queue.
- `prepare(issue)` no longer takes a `mode`. Whoever needs a task-prepend (e.g. conflict-fix) calls `fsChange.prependTask(changeName, directive)` first.
- `spawnWorker({ cwd, changeName, steeringNote?, prependTask? })` accepts an optional `prependTask` _only as a courtesy_; production callers should use `fs-change` directly so the prepend is observable on the bus.

## RLF-39 invariant

The current protection is `throw err` inside `wire.ts:796-807`. After this change:

- `git.createWorktree` capability has `required: true`.
- `runCapability` rethrows on `required` failures _before_ any return path exists, so there is no `wt = projectRoot` fallback to reintroduce by accident.
- Wire's prepare flow becomes: `const wt = await runCapability(git.createWorktree, ...)` — there is no `try/catch` swallowing the throw. The only handler is one level up where the issue is quarantined with `ralph:error`.

## PollContext

Moved verbatim to `shared/capabilities/poll-context.ts`. New tests:

- Same `(url, fields)` returns the same promise (memo hit).
- Different field order, same set → memo hit (key uses sorted fields).
- Two `PollContext` instances do not share memos.
- Calling `clear()` (used by tests) drops memos.

## ESLint rule

`apps/agent/eslint.config.ts` (or root config — to be confirmed during impl):

```ts
'no-restricted-imports': ['warn', {
  patterns: [
    // No cross-feature imports between sibling feature directories
    { group: ['../*/*'], message: 'features must not import siblings; go through shared/' },
    // features must not import runtime or consumers
    { group: ['**/runtime/**', '**/consumers/**'], message: 'features must not import runtime/consumers' },
    // consumers must not reach into features/capabilities
    { group: ['**/features/**', '**/capabilities/**'], message: 'consumers must not import features/capabilities' },
  ],
  paths: [
    // I/O surfaces forbidden in detect.ts (enforced by overrides block on `**/detect.ts`)
  ],
}]
```

An `overrides` block targets `**/detect.ts` and bans imports matching `**/*linear*`, `**/*gh-client*`, `**/git*`, `node:child_process`, and `Bun` global usage (Bun is checked by a small custom no-restricted-syntax selector since it's a global).

Severity is `warn` initially per the issue text so the rule lands without blocking CI on pre-existing violations.

## Migration order (per-capability, smallest blast radius first)

1. `poll-context.ts` — pure move + tests.
2. `fs-change.ts` — wraps the existing scaffold / steering / prepend functions.
3. `git.ts` — wraps `createWorktree` / `removeWorktree` / `seedWorktreeMcpConfig`; flip wire.ts to use it.
4. `gh-client.ts` — wraps every `gh` invocation (pr view / pr checks / pr create / pr merge).
5. `linear-client.ts` — moves transport from `agent/linear.ts`; keeps existing test seam.
6. `worker-spawner.ts` + delete `SpawnMode`. This is the biggest commit; all queue/coordinator/wire branches collapse.
7. Add ESLint rule and chase the warnings (do not auto-fix; rule lands as `warn`).

## Edge cases

- **Linear 429**: today thrown immediately; new behavior retries with `Retry-After` (capped at the same `MAX_RETRY_AFTER_MS = 2000`). Keep `isRateLimitedError()` export for callers that still want to short-circuit.
- **Worktree reuse**: existing behavior (reuse if `git worktree list` already has it) stays inside the capability; that is _not_ an error path.
- **PR view 404** vs network error: `gh-client` formatter must distinguish so PollContext doesn't cache a transient failure forever. Cache promise resolution only on success; on rejection, drop from memo so the next call retries.
- **Steering note delivery**: today appended after spawn in some paths, before in others. After this change it is always `fsChange.appendSteering(changeName, note)` followed by spawn, so the worker sees a consistent file.
