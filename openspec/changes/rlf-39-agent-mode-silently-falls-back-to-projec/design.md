# Design for RLF-39

## Files touched

- `apps/agent/src/agent/wire.ts` — modify `setupWorktree()` (currently around
  L596-635 inside `buildAgentCoordinator`) so the catch around
  `createWorktree()` rethrows instead of silently keeping `workerCwd =
projectRoot`.
- `apps/agent/src/__tests__/wire-setup-worktree.test.ts` (new) — unit test
  that drives `buildAgentCoordinator` with `useWorktree: true` plus a
  `GitRunner` whose `run()` rejects, then exercises the prepare path and
  asserts rejection / no fallback to projectRoot.

## Behaviour change

Before:

```ts
try {
  const wt = await createWorktree(projectRoot, probeName, baseBranch, gitRunner);
  workerCwd = wt.cwd;
  ...
} catch (err) {
  onLog(`! worktree create failed for ${issue.identifier}: ${err.message} — falling back to project root`, "yellow");
}
return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch };
```

After:

```ts
let wt;
try {
  wt = await createWorktree(projectRoot, probeName, baseBranch, gitRunner);
} catch (err) {
  onLog(
    `! worktree create failed for ${issue.identifier}: ${(err as Error).message} — skipping (worktree required)`,
    "red",
  );
  throw err;
}
workerCwd = wt.cwd;
branch = wt.branch;
const wtLayout = projectLayout(wt.cwd);
scaffoldTasksDir = wtLayout.tasksDir;
scaffoldStatesDir = wtLayout.statesDir;
onLog(`  ${issue.identifier} worktree: ${wt.cwd} (${wt.branch})`, "gray");
try {
  await seedWorktreeMcpConfig(projectRoot, wt.cwd);
} catch (err) {
  onLog(`! seeding .mcp.json failed for ${issue.identifier}: ${(err as Error).message}`, "yellow");
}
```

The `seedWorktreeMcpConfig` failure stays non-fatal (the worktree itself was
created successfully, MCP seeding is best-effort).

## Coordinator integration

`AgentCoordinator.launchWorker()` already wraps the call to `prepare()` in a
try/catch (coordinator.ts L558-574), logs red, removes the pendingId, and
spawnNext()s — so a rethrow from setupWorktree propagates without further
change. The issue is retried on the next poll cycle (no quarantine label
yet — keeping the fix minimal per option 1 of the proposal).

## Edge cases

- **`useWorktree: false`**: untouched early-return path. The existing
  `workerCwd = projectRoot` flow remains.
- **Branch already exists locally**: `createWorktree` does not call `git
fetch` in that path, so it cannot fail on missing remotes there.
- **Concurrent same-issue prepares**: pre-existing behaviour — `createWorktree`
  reuses an existing worktree if `worktree list --porcelain` already contains
  the target path. Failure-then-rethrow does not change that.
- **Test pinning**: the new test must not need a real git binary; we inject a
  `GitRunner` whose `run()` rejects.

## Out of scope

- Linear `ralph:error` label quarantine on prepare-failure. The coordinator
  only applies setError after a worker exits; wiring it into the prepare
  failure path would broaden the change unnecessarily. Issue retries each
  poll cycle until the worktree directory / fetch issue is resolved.
- Refactoring `setupWorktree` out into a standalone exported helper. Testing
  via the public `prepare()` path is sufficient for the acceptance criterion.
