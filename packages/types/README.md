# @neriros/ralphy-types

The cross-repo type and Zod-schema contract for [ralphy](https://github.com/rosneri/ralphy).

Inside the monorepo this package is named `@ralphy/types`; it is published to npm as
`@neriros/ralphy-types`, at the same version as `@neriros/ralphy` (both come from the
same `v*` git tag). The published tarball ships the same TypeScript sources the
monorepo imports, so internal and published shapes cannot drift.

```sh
npm install @neriros/ralphy-types
```

## What it exports

| Symbol                                                           | What it is                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `State`, `StateSchema`                                           | the `.ralph-state.json` shape (iteration count, status, cost, history) |
| `HistoryEntry`, `HistoryEntrySchema`                             | one loop iteration record                                              |
| `Usage`, `UsageSchema`, `IterationUsage`, `IterationUsageSchema` | token/cost usage                                                       |
| `Revision`, `RevisionSchema`                                     | a revision entry on the state file                                     |
| `FeedEvent`, `ToolInputSummary`                                  | live-stream events emitted by a running loop                           |
| `Engine`                                                         | `"claude" \| "codex"`                                                  |
| `WORKER_EXIT_CODES`, `WorkerExitCode`                            | worker process exit codes                                              |

`zod` is the only runtime dependency — the schemas are part of the contract.

## Consuming it

The package ships TypeScript source (`exports` points at `./src/types.ts`), so
consumers must be bundler-resolution projects (Vite, Bun, `moduleResolution: "bundler"`).

```ts
import { StateSchema, type FeedEvent, type State } from "@neriros/ralphy-types";
```
