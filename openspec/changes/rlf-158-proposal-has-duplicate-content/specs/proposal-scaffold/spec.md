# Spec: proposal scaffold deduplication

## MODIFIED Requirements

### Requirement: workflow template body must not include issue description

The default workflow template body (`DEFAULT_WORKFLOW_MD`) and the project `WORKFLOW.md` body MUST NOT render `{{ issue.description }}`. The issue description is already placed under `## Why` by `scaffoldChangeForIssue`; including it in the workflow prompt as well causes it to appear twice in the proposal.

#### Scenario: default workflow body omits issue description

Given the default `DEFAULT_WORKFLOW_MD` is rendered with an issue that has a non-empty description,
when `renderWorkflowPrompt` is called,
then the rendered output does NOT contain the issue description text.

#### Scenario: newly scaffolded proposal has description exactly once

Given a Linear issue with a non-empty description,
when `scaffoldChangeForIssue` is called using the updated default workflow (which no longer includes `{{ issue.description }}` in the template body),
then the resulting `proposal.md` contains the description text exactly once (in `## Why`).
