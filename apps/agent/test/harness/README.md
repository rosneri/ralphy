# Agent integration harness

Test-only fakes for the agent coordinator. Used by `apps/agent/src/__tests__/*`
to drive end-to-end scenarios without touching real Linear / GitHub / the
production engine.

## Layout

```
apps/agent/test/harness/
  index.ts              barrel + createHarness()
  types.ts              shared TS types (HarnessCtx, ScenarioStep, …)
  fake-linear.ts        in-memory Linear store + LinearClientLike view
  fake-gh.ts            CmdRunner shim that scripts `gh` argv → JSON
  tmp-repo.ts           real git in a tmpdir
  tmp-fs.ts             .ralph + openspec sandbox
  scripted-engine.ts    transcript player
  clock.ts              virtual clock + tick driver
  scenarios/
    index.ts            scenario registry
    s1-1-fresh-todo.ts  example scenario
  __tests__/            unit tests for each fake
```

## Entry point

```ts
import { createHarness } from "../../test/harness";
import { AgentCoordinator } from "../runtime/coordinator";

const h = await createHarness({ scenario: "s1.1-fresh-todo" });
const coord = new AgentCoordinator(h.coordDeps, {
  concurrency: 1,
  setInProgress: { type: "status", value: "In Progress" },
  setDone: { type: "status", value: "Done" },
});

await coord.pollOnce();
expect(h.linear.applied.setInProgress).toContain("RLF-EX-1");
await h.runWorkerToCompletion();
expect(h.linear.applied.setDone).toContain("RLF-EX-1");
await h.cleanup();
```

`createHarness()` composes `tmpFs → tmpRepo → fakeLinear → fakeGh →
scriptedEngine → clock` and returns a fully wired `CoordinatorDeps`-shaped
`coordDeps` plus inspection helpers (`linear.applied`, `gh.calls`,
`clock.now()`).

## Authoring a new scenario

1. Add a definition file under `scenarios/`, exporting a
   `ScenarioDefinition` (`name`, `seedIssues`, `transcript`).
2. Register it in `scenarios/index.ts` under its dotted name
   (e.g. `"s2.3-conflict-fix"`).
3. Reference it from a test via `createHarness({ scenario: "..." })`.

The `transcript` is an array of `ScenarioStep` values consumed by the
scripted engine. A minimal "1 diff, exit 0" looks like:

```ts
transcript: [
  { kind: "message", payload: "starting" },
  { kind: "diff", payload: "+ added a line\n" },
  { kind: "exit", payload: { code: 0 } },
],
```

When the engine runs out of steps it throws — tests fail loudly instead
of silently hanging. Extend the transcript when adding new turns.

## Determinism contract

The harness guarantees:

- **No real clock.** Time flows only via `clock.advance(ms)`. `clock.tick()`
  drains pending microtasks so callers can inspect state synchronously
  after an `await`.
- **No real Linear network.** Every coordinator call goes through
  `FakeLinear.client`. The `applied` log records each indicator mutation.
- **No real GitHub network.** Every `gh` invocation goes through
  `fake-gh`. Unscripted argv shapes throw `scripted shim: no rule for …`.
- **Real git, but only inside `tmp-repo.dir`.** Test authors should pass
  the tmpdir's path as the cwd for any git invocation they exercise; the
  harness never spawns `git` outside the tmpdir.
- **Scripted engine.** Unscripted engine calls throw — tests must extend
  the transcript when the production loop grows new turns.

## Cleanup

`h.cleanup()` removes both `tmpFs.root` and `tmpRepo.dir`. Always call
it in an `afterEach` (or after the `expect` block in a single-shot
test). The harness owns no globals, so a failed cleanup only leaks a
tmpdir.
