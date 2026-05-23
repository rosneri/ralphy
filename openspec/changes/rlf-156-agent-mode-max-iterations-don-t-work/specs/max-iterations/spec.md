# Spec: max-iterations applies to total cumulative iteration count

## MODIFIED Requirements

### Requirement: max-iterations enforced across process respawns

The loop MUST compare `--max-iterations` against the total cumulative iteration count (iterations from all prior runs plus the current run), not just the in-process counter.

#### Scenario: agent respawns worker that already hit the limit

Given a task with `state.iteration = 5` and `--max-iterations 5`,
When the agent spawns a new worker process for that task,
Then the loop exits immediately without invoking the engine.

#### Scenario: fresh run respects max-iterations

Given a task with `state.iteration = 0` and `--max-iterations 3`,
When the loop runs,
Then it invokes the engine exactly 3 times before stopping.

#### Scenario: unlimited runs are unaffected

Given `--max-iterations 0` (unlimited),
When the loop runs on any state,
Then the iteration count does not cause the loop to stop.
