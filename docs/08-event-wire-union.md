## Context (EPIC)

The event wire format exists as **four independent, drifting copies** with no generation between them. They have **already concretely diverged**: the web client drops 4 server‑emitted event kinds and dispatches a `progress` event no one emits, and `worker_pr` emits `prUrl` while the canonical union declares `url` (an index signature hides the mismatch). Promote one union to a shared module consumed by both the sidecar and the client.

Related closed RFC: #401.

## Current state (verified 2026-06-13)

The four copies:

- `packages/events/src/types.ts:29-386` — `RalphEvent` (the most complete union).
- `packages/core/src/loop-runner/index.ts:63-73` — `LoopRunnerEvent`.
- `apps/ui/src/hooks/useTaskStream.ts:17-88` — client `WsMessage` (drops 4 kinds, adds phantom `progress`).
- `apps/loop/src/debug.ts` — `JsonlEntry`.

Concrete drift to fix:

- `worker_pr`: `packages/events/src/types.ts:259-264` declares `url`; emitter `apps/agent/src/agent/json-runner.ts:176` and consumer `apps/agent/src/components/AgentMode.tsx:655` use `prUrl`.
- Client/server event‑kind mismatch at `apps/ui/src/hooks/useTaskStream.ts:17-88` vs `apps/ui/src-sidecar/routes/loop.ts:153-154`.

## Goal

One canonical event union in `@ralphy/events`, imported by the sidecar emitter and the web client decoder (delete the hand‑rolled `WsMessage` and `JsonlEntry` copies, or make them type‑aliases of the canonical union). The wire format becomes the single source of truth.

## Sub‑tasks (land as separate sub‑PRs)

- [ ] **8a — Reconcile `worker_pr` field.** Pick `url` (canonical) and update the `prUrl` emitter + consumer (`json-runner.ts:176`, `AgentMode.tsx:655`), OR rename canonical to `prUrl` everywhere. Remove the index signature that hid the mismatch so the type checker enforces it. Add a test asserting an emitted `worker_pr` round‑trips through the union with the field present.
- [ ] **8b — Make `LoopRunnerEvent` (core) reference the canonical union** rather than re‑declaring overlapping kinds. If core cannot depend on `@ralphy/events` (check the dep direction — `events` currently depends on `telemetry`; core already depends on `events`), import from `@ralphy/events`. Confirm no dependency cycle (`bun run check:deps`).
- [ ] **8c — Client decoder uses the canonical union.** Replace `useTaskStream.ts`'s `WsMessage` with the canonical type; handle every event kind the sidecar can emit; delete the phantom `progress` branch (or emit it for real if intended). Add a compile‑time exhaustiveness check (`switch` with `never` default) so a new event kind forces a client update.
- [ ] **8d — `debug.ts` `JsonlEntry`** becomes an alias of the canonical union (or is derived from it).
- [ ] **8e — Drift guard.** Add `scripts/check-event-union.ts` (or a type‑level test) that fails if a second hand‑rolled event union appears, and wire it into `check:structure`.

## Acceptance criteria

- [ ] Exactly one event union is authored; the other three sites import/alias it.
- [ ] The client handles every sidecar‑emitted kind; no phantom kinds; exhaustiveness enforced with a `never` default.
- [ ] `worker_pr` field name is consistent end‑to‑end with no masking index signature.
- [ ] `bun run typecheck`, `bun run check:deps` (no cycle), `bun test` (events + agent + ui) pass; coverage not reduced.

## Verification

```bash
bun run typecheck
bun run check:deps           # must stay cycle-free
bun test packages/events/src apps/agent/src apps/ui/src
```

## Risk / blast radius

**Medium.** Touches the live UI stream. Mitigate by landing 8a–8e as small sub‑PRs, each green on its own. The exhaustiveness check turns future drift into a compile error.

## Effort

**L** (epic; ~5 sub‑PRs).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
