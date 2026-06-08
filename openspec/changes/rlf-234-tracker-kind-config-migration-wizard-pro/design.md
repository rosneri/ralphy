# Design — RLF-234: tracker.kind config + migration + wizard + provider selection

## Goal

Make the issue tracker pluggable. Today Linear is hard-wired: `wire.ts` builds `createLinearResolvers(...)` and consumes a fixed set of operations off it. This change adds a `tracker.kind` config switch, a v6→v7 migration that is a no-op for existing Linear users, a wizard step, and a `wire.ts` selection point that returns either the Linear resolver (unchanged) or a new GitHub provider built on the `gh` CLI.

## Current state (verified)

- `packages/workflow/src/schema.ts:9` — `CURRENT_WORKFLOW_VERSION = 6`. The `WorkflowConfigSchema` already has a `github` block (line 297) (`base_branch`, `auto_merge_strategy`) that is currently **unused**, and a large `linear` block.
- `apps/init/src/migrations.ts` — `MIGRATIONS` array (entries v1–v6). `LATEST_MIGRATION_VERSION` is asserted equal to `CURRENT_WORKFLOW_VERSION` by `apps/init/src/__tests__/migrations.test.ts`, and every migration `fields` id must exist in the field catalogue.
- `packages/workflow/src/wizard.ts` — `doc.setIn(id.split("."), value)` writes each answered field at its dotted path; `stampDescriptions` stamps each catalogue field's description as a YAML comment; `version` is always stamped to `CURRENT_WORKFLOW_VERSION`.
- `packages/workflow/src/fields.ts` — field catalogue; fields have `{ id, label, description, spec, when? }`. Select fields use `spec: { kind: "select", options: [...] }`. `when` gates a field on prior answers.
- `apps/agent/src/agent/wire.ts:197` — `createLinearResolvers(...)`. Consumed surface: `fetchByGet`, `applyIndicator`, `removeIndicator`, `applyMarker`, `resolveLabelIdForTeam` (lines 281, 327-328, 386-404, 476), plus `fetchDoneCandidatesWith` from `wire/linear-resolvers.ts`.
- No `TrackerProvider` / `GithubTrackerProvider` / `LinearTrackerProvider` exists today — Linear is called directly. Issue fetch entry point: `apps/agent/src/shared/capabilities/linear-client.ts` `fetchOpenIssues`.
- GitHub is already shelled via `gh` for PR/CI/mention work (`apps/agent/src/features/mention/github.ts`, `wire/pr-helpers.ts`). The `gh` CLI is an established dependency.

## Files to touch

| File                                                            | Change                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/workflow/src/schema.ts`                               | Bump `CURRENT_WORKFLOW_VERSION` → 7; add `tracker` block; add `github.issues` sub-block.       |
| `packages/workflow/src/default.ts` (`DEFAULT_WORKFLOW_MD`)      | Add `tracker:` and `github.issues:` keys so descriptions stamp and defaults are documented.    |
| `packages/workflow/src/fields.ts`                               | Add `tracker.kind` field + `github.issues.*` fields (gated `when` github).                     |
| `apps/init/src/migrations.ts`                                   | Add v7 `MIGRATIONS` entry; its `fields` list the new ids.                                      |
| `apps/init/src/SetupWizard.tsx`                                 | Surface the new questions in the flow (and any control-answer handling).                       |
| `apps/agent/src/agent/wire/tracker/types.ts` (new)              | `TrackerProvider` interface + `TrackerIssue` shape.                                            |
| `apps/agent/src/agent/wire/tracker/github.ts` (new)             | `createGithubTrackerProvider` (gh-CLI backed).                                                 |
| `apps/agent/src/agent/wire/linear-resolvers.ts`                 | Have the returned resolver conform to `TrackerProvider` (additive typing; no behavior change). |
| `apps/agent/src/agent/wire.ts`                                  | Select Linear vs GitHub provider by `cfg.tracker.kind`.                                        |
| `openspec/changes/.../specs/tracker-provider-selection/spec.md` | Spec delta (added).                                                                            |

## Schema shape

```ts
// new top-level block
tracker: z.object({
  kind: z.enum(["linear", "github"]).default("linear"),
}).strict().default({ kind: "linear" }),

// extend existing github block
github: z.object({
  base_branch: z.string().optional(),
  auto_merge_strategy: z.enum(["squash", "merge", "rebase"]).optional(),
  issues: z.object({
    repo: z.string().optional(),            // "owner/name"; defaults to detected repo
    label: z.string().optional(),           // todo filter label
    assignee: z.string().optional(),        // filter by assignee login (or "@me")
    statusLabels: z.object({
      inProgress: z.string().default("ralph:in-progress"),
      done: z.string().default("ralph:done"),
      error: z.string().default("ralph:error"),
    }).strict().default({ inProgress: "ralph:in-progress", done: "ralph:done", error: "ralph:error" }),
  }).strict().optional(),
}).strict().optional(),
```

`tracker` defaults to `{ kind: "linear" }`, so a v6 file with no `tracker` key parses to today's behavior exactly. `github.issues` stays optional and is only consulted when `tracker.kind === "github"`.

## Provider seam

Define the interface from the surface `wire.ts` already uses, so the Linear path is a pure re-typing:

```ts
interface TrackerProvider {
  fetchByGet(inc, excl): Promise<TrackerIssue[]>;
  applyIndicator(issue, ind): Promise<void>;
  removeIndicator(issue, ind): Promise<void>;
  applyMarker(issue, marker): Promise<void>;
  fetchDoneCandidates(...): Promise<TrackerIssue[]>;
  resolveLabelIdForTeam?(teamKey, label, group?): Promise<string | null>; // linear-only, optional
}
```

`TrackerIssue` is the subset of `LinearIssue` the loop reads (identifier, title, url, labels, state). The Linear resolver already returns `LinearIssue`, which is assignable. `wire.ts` builds:

```ts
const provider = cfg.tracker.kind === "github"
  ? createGithubTrackerProvider({ cfg: cfg.github?.issues, cmdRunner, diag })
  : createLinearResolvers({ apiKey, team, ... });
```

and threads `provider` where `resolvers` is used today.

## GitHub provider (gh CLI)

Maps the indicator/marker vocabulary onto labels + issue lifecycle:

| Operation                       | gh command                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `fetchByGet(getTodo)`           | `gh issue list --repo R --label <todo> [--assignee A] --state open --json number,title,url,labels,state` |
| `applyIndicator(setInProgress)` | `gh issue edit <n> --add-label <inProgress> --remove-label <todo>`                                       |
| `applyIndicator(setDone)`       | `gh issue edit <n> --add-label <done>` then `gh issue close <n>`                                         |
| `applyIndicator(setError)`      | `gh issue edit <n> --add-label <error>`                                                                  |
| `applyMarker(comment)`          | `gh issue comment <n> --body ...`                                                                        |
| `fetchDoneCandidates`           | `gh issue list --label <inProgress> --state open ...`                                                    |

All shell-outs go through the existing `cmdRunner` (`Bun.spawn`-backed) — never `node:fs` sync, never `node:child_process`. `TrackerIssue.identifier` for GitHub is the issue number (e.g. `#42` / `42`), used for branch naming and PR-title search just as the Linear identifier is.

## Migration

Add to `MIGRATIONS`:

```ts
{ version: 7,
  description: "Pick your issue tracker: Linear (default) or GitHub Issues. ...",
  fields: ["tracker.kind", "github.issues.repo", "github.issues.label",
           "github.issues.assignee", "github.issues.statusLabels.inProgress",
           "github.issues.statusLabels.done", "github.issues.statusLabels.error"] }
```

Every id must have a catalogue field (the migrations test enforces this). Files at v6 migrate to v7; with no answers the schema defaults fill `tracker.kind: linear`, so the migration is behavior-preserving.

## Data flow

```
WORKFLOW.md ──parse──▶ WorkflowConfigSchema ──cfg.tracker.kind──▶ wire.ts
                                                          │
                              ┌───────────────────────────┴───────────────────┐
                       kind=linear                                       kind=github
                  createLinearResolvers                          createGithubTrackerProvider
                  (Linear GraphQL, unchanged)                    (gh issue list/edit/comment/close)
                              └───────────────── TrackerProvider ────────────────┘
                                                          │
                                       coordinator / loop (fetchTodo, applyIndicator, ...)
```

## Edge cases

- **Absent `tracker` block** → schema default `kind: linear`; existing tests must pass unchanged. This is the critical no-regression case.
- **`kind: github` but `github.issues` absent/missing repo** → fall back to the repo detected from `origin`; if none, surface a clear config error at provider construction (not a silent empty fetch).
- **Migration sync** → `CURRENT_WORKFLOW_VERSION` must equal `LATEST_MIGRATION_VERSION` (7); the existing test guards this.
- **Field-catalogue sync** → every v7 migration field id must resolve to a catalogue field, else the migrations test fails.
- **Wizard gating** → `github.issues.*` questions only appear when `tracker.kind === "github"`; when Linear is chosen the github keys must not be written (control-answer / `when` handling in `SetupWizard.tsx`).
- **`gh` not authenticated / repo not found** → provider operations should propagate a readable error through `diag`, mirroring how the Linear path surfaces API errors.
- **`.strict()` on the github block** → adding `issues` must keep existing `github` configs (with only `base_branch`/`auto_merge_strategy`) valid.

## Out of scope

- Full feature parity between GitHub and Linear (attachments, projects, confirmation-mode comment gating, spec-PDF attachments). The GitHub provider implements the lifecycle the e2e demo needs: fetch todo, set in-progress, comment, set done/close, set error. Richer parity is a follow-up.
- Changing the Linear code paths beyond conforming them to the `TrackerProvider` type.
