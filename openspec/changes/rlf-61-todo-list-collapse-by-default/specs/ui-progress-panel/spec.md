# ui-progress-panel — todo list collapse by default

## ADDED Requirements

### Requirement: PROGRESS sections MUST be collapsed by default

The `ProgressList` component in the task detail right-panel MUST render every
section header as a clickable disclosure, and every section MUST start in the
collapsed state on first render. While collapsed, only the section title and
its item count are visible; the individual checkbox items MUST NOT be
rendered. Clicking a section header MUST toggle its expanded state.

State is local to the component — there is no persistence across page reloads
or task switches, and no global "expand all" control.

#### Scenario: opening the PROGRESS panel shows only section headers

- **Given** a task whose progress stream has produced two sections, "Planning" and "Implementation", each with several checkbox items
- **When** the operator expands the PROGRESS accordion in the task detail view
- **Then** both section headers are visible
- **And** none of the individual checkbox items are rendered until a header is clicked

#### Scenario: clicking a section header expands its items

- **Given** the PROGRESS panel is open with all sections collapsed
- **When** the operator clicks the "Planning" section header
- **Then** the "Planning" section's checkbox items become visible
- **And** other sections remain collapsed

#### Scenario: clicking an expanded section header collapses it again

- **Given** the "Planning" section is expanded
- **When** the operator clicks the "Planning" section header again
- **Then** the "Planning" section's items are hidden
- **And** only its header (with item count) remains visible

#### Scenario: a new section appearing mid-run is collapsed

- **Given** the PROGRESS stream emits a new section "Verification" after the panel has been opened
- **When** the new section first renders
- **Then** it appears collapsed regardless of which other sections the operator has expanded
