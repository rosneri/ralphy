# machines/

XState v5 state machines for `@ralphy/core`.

## File naming convention

| What            | Convention                           | Example                                                      |
| --------------- | ------------------------------------ | ------------------------------------------------------------ |
| Machine file    | `<domain>.machine.ts`                | `coordinator.machine.ts`                                     |
| Exported symbol | `<domain>Machine`                    | `export const coordinatorMachine`                            |
| Test file       | `__tests__/<domain>.machine.test.ts` | `__tests__/coordinator.machine.test.ts`                      |
| Barrel export   | Add to `index.ts`                    | `export { coordinatorMachine } from "./coordinator.machine"` |

## Test pattern

Use `createActor` (XState v5 API) with snapshot assertions:

```ts
import { createActor } from "xstate";
import { myMachine } from "../my.machine";

test("transitions to active on START", () => {
  const actor = createActor(myMachine).start();
  actor.send({ type: "START" });
  expect(actor.getSnapshot().value).toBe("active");
});
```

## Mocking Bun.spawnSync

When a machine action calls `Bun.spawnSync`, mock it directly in the test:

```ts
import { spyOn } from "bun:test";

const spy = spyOn(Bun, "spawnSync").mockReturnValue({ exitCode: 0 } as any);
// ... run the machine ...
spy.mockRestore();
```

See `packages/openspec/src/__tests__/openspec-change-store.test.ts` for the full pattern.

## Adding a new machine

1. Create `<domain>.machine.ts` using `setup()` + `createMachine`.
2. Add `export { <domain>Machine } from "./<domain>.machine"` to `index.ts`.
3. Add tests in `__tests__/<domain>.machine.test.ts`.

The `example.machine.ts` is a throwaway reference — delete it once a real machine lands.
