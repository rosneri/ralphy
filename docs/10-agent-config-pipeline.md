## Context (EPIC)

`#404` delivered a clean single config pipeline (sparse `CliOverrides`, one pure `mergeConfig` with a provenance witness, child workers re‑resolve from forwarded overrides). `apps/loop` honors it. **`apps/agent` bypasses it**: it runs a second, lower‑fidelity boot path and merges seven agent‑only flags with the exact `args.x || cfg.y` + sentinel anti‑patterns the pipeline exists to forbid. This is latent today (spawned workers re‑resolve through the full pipeline) but is a live divergence hazard.

Related closed RFC: #404.

## Current state (verified 2026-06-13)

- Parallel path: `apps/agent/src/agent/config.ts:17-24` `loadRalphyConfig` calls `mergeConfig` **without `explicitKeys`**, discarding the provenance witness. Used at `apps/agent/src/index.ts:78-82` and `json-runner.ts:112`.
- Seven agent‑only flags (`concurrency`, `pollInterval`, `linearTeam`, `worktree`, `createPr`, `stackPrs`, `codeReview`) live outside `CliOverrides` and are merged via ~12 `args.x || cfg.y` sites: `apps/agent/src/agent/wire.ts:117,118,120,150,457`, `wire/spawn/worker.ts:199,433`, `wire/mention-scan.ts:112`, etc.
- `parseAgentArgs` reintroduces `0`/`""`/`false` pre‑filled‑default sentinels: `apps/agent/src/cli.ts:203-211,244,249`.

Discovery:

```bash
rg -n '\|\|\s*(cfg|config)\.' apps/agent/src --type ts | rg -v '__tests__'
rg -n 'loadRalphyConfig' apps/agent/src --type ts
```

## Goal

`apps/agent` resolves config through the **same** `resolveParsedConfig`/`mergeConfig` entry as `apps/loop`, with a typed sparse `AgentOverrides` for the agent‑only flags (presence = intent, no sentinels), and zero `args.x || cfg.y` merge sites.

## Sub‑tasks (land as separate sub‑PRs)

- [ ] **10a — Model `AgentOverrides`.** Define a sparse overrides type for the 7 agent‑only flags with its own workflow‑key map, merged _inside_ `mergeConfig` using `??`/presence semantics (mirror the existing `CliOverrides` pattern in `packages/config` / `packages/cli-args`).
- [ ] **10b — Kill sentinels in `parseAgentArgs`** (`cli.ts:203-211,244,249`): emit a key only when the user actually passed the flag (sparse), never a pre‑filled `0`/`""`/`false`.
- [ ] **10c — Replace `loadRalphyConfig`** with `resolveParsedConfig` and read `effective` (+ `.origin()` where useful). Delete `agent/config.ts`'s parallel merge.
- [ ] **10d — Delete the ~12 `args.x || cfg.y` sites** (`wire.ts`, `wire/spawn/worker.ts`, `wire/mention-scan.ts`), reading from the resolved effective config instead.
- [ ] **10e — Assignee/indicator overrides** (`wire.ts:124-128`, `wire/indicators.ts:10`, `workflow/linear-filter.ts:120`): fold into the same presence convention, or document them as sanctioned exceptions with a comment + test.
- [ ] **10f — Add a guard** `scripts/check-config-merge.ts` that fails on `args.x || cfg.y` / `args.x !== <default>` patterns in app code, wired into `check:structure` (ratcheting: grandfather any remaining sanctioned exceptions via an allowlist).

## Acceptance criteria

- [ ] `apps/agent` boots via `resolveParsedConfig` only; `loadRalphyConfig` is deleted.
- [ ] No `args.x || cfg.y` config‑merge sites remain in `apps/agent/src` (except an explicit, tested allowlist).
- [ ] `parseAgentArgs` emits sparse overrides (no falsy pre‑filled defaults); a regression test asserts `--concurrency 0` and an _unset_ concurrency resolve differently.
- [ ] `bun run typecheck`, `bun test` (agent + config + cli-args), `bun run check:structure` pass; coverage not reduced.

## Verification

```bash
rg -n 'loadRalphyConfig' apps/agent/src                          # expect: none
rg -n '\|\|\s*(cfg|config)\.' apps/agent/src --type ts | rg -v '__tests__'   # expect: only allowlisted
bun run typecheck && bun run check:structure
bun test apps/agent/src packages/config/src packages/cli-args/src
```

## Risk / blast radius

**Medium.** Config resolution is load‑bearing. The falsy‑zero regression test (10b) and per‑flag sub‑PRs contain risk. Behavior must be identical except the intended sentinel fix.

## Effort

**L** (epic; ~6 sub‑PRs).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
