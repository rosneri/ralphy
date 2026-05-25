# Spec: auto verbosity for the first five moments

## ADDED Requirements

### Requirement: buildTaskPrompt injects a very-short verbosity block for the first five iterations

When building the task prompt, if `state.iteration < 5`, the prompt MUST begin with a "Verbosity: VERY SHORT" block instructing the agent to keep its response brief and take one small step only.

#### Scenario: moment 1 — first iteration gets short block

Given a change where `state.iteration = 0`,
When `buildTaskPrompt` is called,
Then the returned prompt starts with a block containing "Verbosity: VERY SHORT" and "Moment 1/5".

#### Scenario: moment 5 — last warm-up iteration still gets short block

Given a change where `state.iteration = 4`,
When `buildTaskPrompt` is called,
Then the returned prompt contains "Verbosity: VERY SHORT" and "Moment 5/5".

#### Scenario: moment 6 — first post-warm-up iteration has no short block

Given a change where `state.iteration = 5`,
When `buildTaskPrompt` is called,
Then the returned prompt does NOT contain "Verbosity: VERY SHORT".

#### Scenario: verbosity block precedes steering content

Given a change where `state.iteration = 0` and a `steering.md` file exists,
When `buildTaskPrompt` is called,
Then the "Verbosity: VERY SHORT" block appears before any steering content in the prompt.
