## Context

`apps/agent/src/shared/capabilities/github/github-client.ts` (494 LOC) is a second, dead GitHub‑issue IO layer. It was superseded by the live tracker provider in `apps/agent/src/agent/wire/tracker/github*.ts` (the #403 seam). Of its ~21 exports, only the **identifier‑strategy** piece is still consumed; the entire `gh`‑subprocess function bag is dead, kept alive only by its own ~322‑line test. A second GitHub mapper is exactly the kind of latent divergence the tracker seam was meant to remove.

Related closed RFC: #403.

## Current state (verified 2026-06-13)

Per‑export live‑consumer count (non‑test, non‑dist, excluding the file itself):

| Export                                                                                                                                                                                                                                                                                                                           | Live consumers                  | Verdict          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------- |
| `githubIdentifierStrategyImpl`                                                                                                                                                                                                                                                                                                   | 1 (`identifier-strategy.ts:16`) | **KEEP**         |
| `listIssues`                                                                                                                                                                                                                                                                                                                     | 1                               | check (see note) |
| `listComments`                                                                                                                                                                                                                                                                                                                   | 1                               | check (see note) |
| `parseGitHubIdentifier`, `changeNameForGitHubIssue`, `branchNameForGitHubIssue`, `numberFromGitHubChangeName`, `numberFromGitHubBranch`, `statusLabelType`, `deriveTrackedState`, `mapGhIssue`, `viewIssue`, `createComment`, `addLabel`, `removeLabel`, `createLabel`, `listLabels`, `closeIssue`, `reopenIssue`, `addReaction` | 0                               | **DELETE**       |

> Note: the 1 "live" consumer reported for `listIssues`/`listComments` must be re‑checked — confirm whether that consumer is the live tracker provider or another dead module. The reference grep is in the Plan. Only the `gh`‑subprocess functions with **zero** live consumers are in scope to delete.

`identifier-strategy.ts:10` documents that the impl lives in `github-client.ts` "to avoid a runtime import cycle" and is re‑exported.

## Scope

- **In:** extract the still‑live identifier code into a focused module; delete the dead `gh`‑subprocess functions and their tests.
- **Out:** the live tracker provider in `agent/wire/tracker/` (canonical — do not touch).

## Plan

1. **Classify every export** (run and record the count per symbol):
   ```bash
   for sym in parseGitHubIdentifier changeNameForGitHubIssue branchNameForGitHubIssue \
     numberFromGitHubChangeName numberFromGitHubBranch githubIdentifierStrategyImpl \
     statusLabelType deriveTrackedState mapGhIssue listIssues viewIssue listComments \
     createComment addLabel removeLabel createLabel listLabels closeIssue reopenIssue addReaction; do
     n=$(rg -l "\b$sym\b" apps/agent/src packages --type ts | rg -v '__tests__|/dist/|github-client.ts' | wc -l | tr -d ' ')
     echo "$sym : $n"
   done
   ```
2. Create `apps/agent/src/shared/capabilities/github/github-identifiers.ts` containing **only** the exports with ≥1 live consumer plus their private helpers and the `GitHubIssueRef` type / `ParsedGitHubIdentifier` type they need. Make it IO‑free (no `gh` subprocess calls).
3. Repoint `identifier-strategy.ts` (and any other live consumer) to import from `github-identifiers.ts`.
4. Delete `github-client.ts` and its test file `__tests__/github-client*.test.ts`. If steps 1–3 showed `listIssues`/`listComments` are consumed by a _live_ module, instead leave just those + their helpers in the new module and delete the rest; never delete a symbol with a live consumer.
5. `bun install` is not needed; run the gates.

## Acceptance criteria

- [ ] `github-client.ts` is deleted (or reduced to only symbols proven live).
- [ ] The live identifier strategy still works; `identifier-strategy.ts` imports from the new IO‑free module.
- [ ] `rg -n 'github-client'` returns no source hits.
- [ ] `bun run typecheck`, `bun run check:deps`, `bun run check:unused` pass; `bun test apps/agent/src` is green; **coverage does not drop** (deleting dead code + its dead test is expected to keep or raise coverage — do not delete any _live_ test).

## Verification (all must pass)

```bash
rg -n 'github-client' apps packages --type ts | rg -v '/dist/'   # expect: no output
bun run typecheck
bun run check:deps
bun run check:unused
bun test apps/agent/src
```

## Risk / blast radius

**Low–Medium.** The risk is mis‑classifying a live export; step 1's matrix + the "never delete a symbol with a live consumer" rule mitigate it. Removing the dead `gh` bag has no runtime path (the tracker provider is the live one).

## Effort

**M** (≈1–2 h).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
