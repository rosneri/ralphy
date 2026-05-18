# linear-sync — filter agent planning tasks from synced tasks comment

## MODIFIED Requirements

### Requirement: renderTasksBlock MUST omit the Planning section from the synced Linear comment

The function MUST filter out agent-bookkeeping Planning bullets and MUST emit a placeholder when no other sections remain.

The `renderTasksBlock` function in `apps/agent/src/agent/linear-sync/index.ts`
renders the body of the sticky "📝 Tasks" Linear comment. It MUST skip any
section whose `##` heading equals `Planning` (case-insensitive, leading/trailing
whitespace ignored) so that agent-bookkeeping items scaffolded into `tasks.md`
do not appear in Linear.

All other sections (e.g. `Implementation`, or any custom mission section the
agent appends) MUST continue to render unchanged, in the order they appear in
`tasks.md`.

The full markers (`<!-- ralphy:tasks:start -->` / `<!-- ralphy:tasks:end -->`)
and trailing `<sub>` footer with change name + iteration MUST still wrap the
rendered body.

When filtering leaves no sections to render (e.g. `tasks.md` only contains a
Planning section), `renderTasksBlock` MUST emit a single italicised line
`_No mission tasks yet — planning in progress._` between the markers instead of
an empty body.

#### Scenario: Planning-only tasks.md renders a placeholder

- **Given** a `tasks.md` whose only `##` section is `## Planning` with one or
  more bullets
- **When** `renderTasksBlock(md, meta)` is called
- **Then** the returned string starts with `<!-- ralphy:tasks:start -->` and
  ends with `<!-- ralphy:tasks:end -->`
- **And** the body contains `_No mission tasks yet — planning in progress._`
- **And** the body does NOT contain `**Planning**` or any of the Planning
  bullets

#### Scenario: Planning section is dropped when other sections exist

- **Given** a `tasks.md` containing `## Planning` followed by `## Implementation`
- **When** `renderTasksBlock(md, meta)` is called
- **Then** the returned string does NOT contain `**Planning**`
- **And** the returned string contains `**Implementation**` and every
  Implementation bullet

#### Scenario: heading casing variants are filtered

- **Given** a `tasks.md` whose heading is `## planning` (lowercase) or
  `## PLANNING` (uppercase)
- **When** `renderTasksBlock(md, meta)` is called
- **Then** that section is omitted from the rendered body
