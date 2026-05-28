# meta-prompt Specification

## Purpose

TBD - created by archiving change rlf-162-add-task-level-meta-prompt-layer-in-ralp. Update Purpose after archive.

## Requirements

### Requirement: `buildMetaPrompt` produces a preamble for every iteration prompt

`buildMetaPrompt(state, phase, options?)` MUST return a non-empty string containing the change name, engine/model, active phase, and iteration number when `options.enabled` is not `false`. When `options.enabled === false`, it MUST return exactly `""`.

#### Scenario: Default (no options) emits preamble

- **Given** a state with `name: "my-change"`, `engine: "claude"`, `model: "opus"`, `iteration: 0`
- **When** `buildMetaPrompt(state, "execute")` is called without options
- **Then** the result contains `my-change`, `claude / opus`, `**Phase:** execute`, and `**Iteration:** 1`

#### Scenario: Opt-out returns empty string

- **Given** any state and phase
- **When** `buildMetaPrompt(state, "execute", { enabled: false })` is called
- **Then** the result is exactly `""`

#### Scenario: Budget caps shown when non-zero

- **Given** `options.maxIterations: 10` and `state.iteration: 2`
- **When** `buildMetaPrompt(state, "execute", options)` is called
- **Then** the result contains `3 of 10`

### Requirement: `buildMetaPrompt` emits phase-specific guidance

`buildMetaPrompt` MUST include distinct guidance text for each supported phase (`research`, `plan`, `execute`, `review`). The guidance MUST clearly indicate what the agent is and is not allowed to do in that phase.

#### Scenario: Research phase guidance

- **Given** `phase: "research"`
- **When** `buildMetaPrompt` is called
- **Then** the result instructs the agent not to make code changes

#### Scenario: Plan phase guidance

- **Given** `phase: "plan"`
- **When** `buildMetaPrompt` is called
- **Then** the result instructs the agent to produce proposal/design/tasks artifacts without writing implementation code

#### Scenario: Execute phase guidance

- **Given** `phase: "execute"`
- **When** `buildMetaPrompt` is called
- **Then** the result instructs the agent to work through the tasks.md checklist

#### Scenario: Review phase guidance

- **Given** `phase: "review"`
- **When** `buildMetaPrompt` is called
- **Then** the result instructs the agent not to implement fixes — only audit and document

### Requirement: `buildMetaPrompt` emits a dynamic flags section for active runtime flags

When any notable runtime flag is active (`useWorktree`, `createPr`, `confirmationMode`, `linearIssueIdentifier`), `buildMetaPrompt` MUST emit an "Active Flags" section listing the active flags. When no flags are active, the section MUST be omitted entirely.

#### Scenario: No flags — section omitted

- **Given** no runtime flags set in options
- **When** `buildMetaPrompt` is called
- **Then** the result does NOT contain an "Active Flags" section

#### Scenario: Worktree active — shown with path

- **Given** `options.useWorktree: true` and `options.worktreePath: "/tmp/wt/my-feature"`
- **When** `buildMetaPrompt` is called
- **Then** the result contains "Worktree mode: active" and the worktree path

#### Scenario: PR on success shown

- **Given** `options.createPr: true`
- **When** `buildMetaPrompt` is called
- **Then** the result contains "PR on success: yes"

#### Scenario: Linear issue shown

- **Given** `options.linearIssueIdentifier: "RLF-99"` and `options.linearIssueUrl: "https://linear.app/..."`
- **When** `buildMetaPrompt` is called
- **Then** the result contains both the identifier and URL

### Requirement: `buildPhasePrompt` prepends the meta-prompt before the phase-specific prompt

`buildPhasePrompt` MUST prepend the output of `buildMetaPrompt` before the phase-specific prompt string. When `metaPromptOptions.enabled === false`, it MUST skip the meta-prompt and return only the direct phase builder output.

#### Scenario: Meta-prompt is prepended by default

- **Given** any phase and state
- **When** `buildPhasePrompt(phase, state, taskDir)` is called without metaPromptOptions
- **Then** the result starts with the meta-prompt fragment and contains the phase prompt content

#### Scenario: Opt-out disables meta-prompt

- **Given** `metaPromptOptions.enabled: false`
- **When** `buildPhasePrompt(phase, state, taskDir, undefined, { enabled: false })` is called
- **Then** the result does NOT contain "Task Context" and equals the direct phase builder output

### Requirement: `WorkflowConfig` supports `metaPrompt.enabled` opt-out flag

`WorkflowConfigSchema` MUST include a `metaPrompt` object with an `enabled` boolean field that defaults to `true`. Setting `enabled: false` in WORKFLOW.md MUST disable the meta-prompt layer for all phases.

#### Scenario: Default is enabled

- **Given** a WORKFLOW.md with no `metaPrompt` key
- **When** the config is parsed
- **Then** `config.metaPrompt.enabled` is `true`

#### Scenario: Opt-out via config

- **Given** a WORKFLOW.md with `metaPrompt:\n  enabled: false`
- **When** the config is parsed
- **Then** `config.metaPrompt.enabled` is `false`

### Requirement: Meta prompt MUST be generated at task level

The system MUST generate meta prompt information when executing a task to improve prompt structure and context at the task level.

#### Scenario: Meta prompt is generated for task execution

- **Given** a task is being executed
- **When** the meta prompt layer is invoked
- **Then** task-level meta prompt information is generated
