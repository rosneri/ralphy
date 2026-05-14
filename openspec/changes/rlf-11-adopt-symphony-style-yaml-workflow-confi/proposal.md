# RLF-11: Adopt Symphony-style YAML workflow config (WORKFLOW.md + frontmatter)

Source: [RLF-11](https://linear.app/neriros/issue/RLF-11/adopt-symphony-style-yaml-workflow-config-workflowmd-frontmatter)
Status: Todo
Assignee: Neriya Rosner

## Description

Move ralphy's per-project configuration from `ralphy.config.json` (loose JSON-with-comments) to a Symphony-style `WORKFLOW.md` file: YAML frontmatter for declarative config, Markdown body as the agent prompt template with variables. Borrow the **project / rules / boundaries** primitives from michaelshimeles/ralphy so the same file expresses _what tasks to run_, _under what constraints_, and _how the agent should be prompted_.

**No backwards compatibility.** `ralphy.config.json` is deleted in the same change. The loader only knows about `WORKFLOW.md`. The indicator filter parser only accepts YAML block-style lists. No shims, no fallbacks, no warnings about "both files exist" — there is exactly one config format.

## Inspiration

- [openai/symphony](https://github.com/openai/symphony) — single-spec orchestration; turns work-tracker tickets into isolated autonomous runs (polling, workspaces, agent lifecycle, PR handling).
- [Symphony with Claude Code (sapsaldog)](https://sapsaldog.com/posts/symphony-with-claude-code) — concrete WORKFLOW.md frontmatter + prompt template we'd model after.
- [michaelshimeles/ralphy](https://github.com/michaelshimeles/ralphy) — `.ralphy/config.yaml` with `project`, `commands`, `rules`, `boundaries.never_touch`; multi-engine flags; tasks as Markdown PRDs / YAML / JSON / GitHub Issues with `parallel_group`s.
- [ralphy.goshen.fyi](https://ralphy.goshen.fyi/) — declarative rules-as-config; tasks as Markdown PRDs or YAML; per-engine flags.

## Target shape

`WORKFLOW.md` at repo root. **Indicators are grouped by domain: each** `get…` **is followed by the** `set…` **/** `clear…` **that mutates the same state**, so a reader sees the whole lifecycle in one block.

```yaml
---
project:
  name: ralphy
  language: TypeScript
  framework: Bun + Nx

commands:
  test: bun test
  lint: bun run lint
  build: bun run build:publish
  typecheck: bun run typecheck

rules:
  - "use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync"
  - "never reduce coverage threshold"

boundaries:
  never_touch:
    - "dist/**"
    - ".claude/worktrees/**"

linear:
  team: RLF
  indicators:
    # Todo → In Progress
    getTodo:
      filter:
        - type: status
          value: Todo
    getInProgress:
      filter:
        - type: status
          value: In Progress
    setInProgress:
      type: status
      value: In Progress

    # Done / review hand-off
    setDone:
      type: status
      value: In Review
    getReview:
      filter:
        - type: label
          value: "ralph:review"
    clearReview:
      type: label
      value: "ralph:review"

    # Conflict lifecycle
    getConflicted:
      filter:
        - type: label
          value: "ralph:conflict"
    setConflicted:
      type: label
      value: "ralph:conflict"
    clearConflicted:
      type: label
      value: "ralph:conflict"

    # Auto-merge opt-in
    getAutoMerge:
      filter:
        - type: label
          value: "ralph:auto-merge"

    # Error quarantine
    setError:
      type: label
      value: "ralph:error"

github:
  base_branch: main
  auto_merge_strategy: squash

agent:
  engine: claude          # claude | codex | opencode | cursor | qwen | gemini …
  model: opus
  concurrency: 2
  max_iterations_per_task: 100
  max_consecutive_failures: 5

worktree:
  enabled: true
  cleanup_on_success: false
  setup_script: bun install

ci:
  fix_on_failure: true
  max_attempts: 10
  poll_interval_seconds: 60
---
You are working on {{ issue.identifier }}: {{ issue.title }}.

{% if attempt > 1 %}
Previous attempt failed with: {{ last_error }}
{% endif %}

{{ issue.description }}

Project rules:
{% for rule in project.rules %}- {{ rule }}
{% endfor %}

Never modify: {{ project.boundaries.never_touch | join(", ") }}.
```

`linear.indicators.*` use YAML block-style lists only — no inline JSON arrays. Related indicators (`get` + `set` / `clear` that touch the same status or label) are grouped under a comment header so the lifecycle is readable at a glance.

## Why

1. **Prompt + config + project knowledge co-located.** Today: prompt is hardcoded in `apps/agent/src/agent/scaffold.ts`, config in `ralphy.config.json`, project rules in `CLAUDE.md`. WORKFLOW.md unifies them.
2. `rules` **+** `boundaries` **improve agent steerability.** Borrowed from michaelshimeles/ralphy — declarative constraints surface in every prompt automatically (via the template body) and gate dangerous edits.
3. **Templating.** `{{ issue.identifier }}`, `{{ attempt }}`, `{{ last_error }}` + `{% if %}` / `{% for %}` for retry messaging and rule injection without code changes.
4. **Multi-engine future.** `agent.engine` field maps to the `--claude` / `--codex` / `--opencode` flag set seen in michaelshimeles/ralphy; today we only branch in `config.ts`. Declarative engine selection makes per-project engine choice trivial.
5. **Discoverability.** A single `WORKFLOW.md` at repo root is a recognized convention (Symphony) — easier to onboard.

## What Changes

- New `@ralphy/workflow` package — parses `WORKFLOW.md`, validates with zod, renders the body via a minimal template engine (`{{ var }}`, `{% if %}`, `{% for %}`, `| join`).
- Loader switched from `ralphy.config.json` → `WORKFLOW.md`. `ralphy.config.json` is deleted.
- New `project`, `commands`, `rules`, `boundaries` frontmatter blocks supported alongside the existing flat fields.
- `boundaries.never_touch` enforced in `apps/agent/src/agent/post-task.ts` — the PR phase aborts when committed files match.
- Agent prompt is rendered from the WORKFLOW.md body and threaded into the scaffolded proposal as "Additional instructions".
- `ralph init` creates a default `WORKFLOW.md` from the canonical template.
- Tests cover parse / validate / render / boundary checks.

## Scope

- New package `@ralphy/workflow` — parses `WORKFLOW.md` (frontmatter + body), validates with zod, renders body via minimal template engine (`{{ var }}`, `{% if %}…{% endif %}`, `{% for x in list %}…{% endfor %}`, `| join` filter).
- Schema covers all of today's `RalphyConfigSchema` (`apps/agent/src/agent/config.ts`) plus the new `project`, `commands`, `rules`, `boundaries` blocks. Field names are reorganized for clarity — no obligation to keep the old shape.
- `boundaries.never_touch` enforced in `apps/agent/src/agent/post-task.ts` pre-commit check — agent's diff intersected with these globs fails the iteration with a clear error.
- `ralphy init` writes a `WORKFLOW.md` skeleton populated from `package.json` (project name, scripts → commands), using the **same grouped-indicator layout** as the target shape above (lifecycle comments + get/set/clear adjacency).
- **Update the embedded default config** that `ralphy init` and the schema's defaults emit (today in `apps/agent/src/agent/config.ts:265-` and the comment block around `getAutoMerge`) so the canonical default also uses the grouped layout. The default that ships in source must match the example in this ticket byte-for-byte where layout is concerned.
- Prompt template wired through `apps/agent/src/agent/scaffold.ts` so the rendered body becomes the per-iteration prompt.
- Delete `ralphy.config.json` from the repo and remove its loader/schema. Single config format, single code path.
- Docs: README section "WORKFLOW.md format" with the table of supported variables, filters, and frontmatter fields. Indicator examples use block lists only and the grouped layout.

## Non-goals

- **No backwards compatibility.** No legacy JSON loader, no migration command, no "both files" warning. The old format is gone; users edit one file.
- Full Jinja / Liquid. Stop at: variables, `if`, `for`, `join` filter. Defer macros, inheritance, custom filters.
- Migrating away from Linear-as-source-of-truth. michaelshimeles/ralphy supports Markdown PRDs / JSON tasks / GitHub Issues as alternate sources — we keep Linear primary but design `WORKFLOW.md` source-agnostic enough to plug those in later.

## Acceptance

- `WORKFLOW.md` at repo root is loaded; no other config file is read.
- Every behavior previously controlled by `ralphy.config.json` is reachable through the new YAML schema.
- New `project`, `commands`, `rules`, `boundaries` blocks load, validate, and are accessible as template variables.
- `linear.indicators.*.filter` parses only as a YAML block-style list; inline JSON-array form is rejected with a clear error.
- Indicators in the default-emitted `WORKFLOW.md` (from `ralphy init` and the in-source default) are grouped by lifecycle: `get` and `set`/`clear` for the same status/label sit adjacent under a section comment.
- The agent's prompt is rendered from the WORKFLOW.md body — editing the body changes the prompt without a code change.
- `boundaries.never_touch` actually blocks an agent commit that modifies a matching path; test covers the block.
- Unit tests cover: parse, validate, render (variables, conditionals, loops, filters, missing vars, malformed frontmatter).
- `ralphy.config.json` is deleted from this repo in the same PR; CI is green with only `WORKFLOW.md` present.

## Related

- [RLF-9](https://linear.app/neriros/issue/RLF-9/pr-status-counter) — UI counters benefit from declarative status definitions in WORKFLOW.md.
- [RLF-10](https://linear.app/neriros/issue/RLF-10) — auto-merge fallback config also fits naturally under the new `github:` frontmatter block.
- [RLF-12](https://linear.app/neriros/issue/RLF-12) — `prioritizeAutoMergeUnblocks` knob lives under the new `agent:` block.

## Steering

_Add steering notes here as the loop runs._
