# Ralphy Manual Testing Plan

**Document Version:** 1.0  
**Last Updated:** 2026-05-05  
**Test Status:** Ready for Execution  

## Overview

This document outlines manual testing procedures for validating the Ralphy v2.10.2 release and recent agent-mode improvements. The tests are designed to prevent regressions, validate new features, and ensure stability across core workflows.

### Recent Changes Summary

| Feature/Fix | Version | PR | Type | Impact |
|---|---|---|---|---|
| .mcp.json seeding in worktrees | v2.10.2 | #60 | Feature | MCP server availability in agent-mode |
| Worktree placement | v2.10.1 | #59 | Fix | Worktree location (project-external) |
| agent-state.json unification | v2.9.5 | #58 | Refactor | State management simplification |
| Hook-fix steering | v2.9.4 | #57 | Fix | Pre-commit/pre-push hook failure recovery |
| Retry on hook failures | v2.9.3 | #56 | Fix | Worker resilience |
| Worktree cleanup guards | v2.9.2 | #55 | Fix | Work loss prevention |

---

## 1. Worktree Seeding & MCP Configuration

### Feature: .mcp.json Worktree Seeding

**Purpose:** Ensure engines spawned inside agent-mode worktrees can access the Ralphy MCP server.

#### 1.1 MCP Config Copy to Worktree
- [ ] **Test Setup**
  - Create a test project with `.mcp.json` containing the ralphy MCP server config
  - Verify `.mcp.json` exists in project root
  - `.mcp.json` contains `.ralph/bin/mcp.js` reference
  
- [ ] **Expected Behavior**
  - When agent mode creates a new worktree, `.mcp.json` is copied to worktree root
  - The copy completes without errors
  - Worktree has identical `.mcp.json` (with rewritten paths)
  
- [ ] **Validation Steps**
  1. Run: `ralph agent --linear-team TEST --linear-assignee test@example.com --concurrency 1 --poll-interval 600` (with mock Linear issue)
  2. Wait for worktree creation
  3. Verify: `ls -la <worktree>/.mcp.json` exists
  4. Compare: `cat <worktree>/.mcp.json` vs `cat .mcp.json`
  5. Verify paths are rewritten: `.ralph/bin/...` → `/absolute/path/...`

#### 1.2 Relative Path Rewriting
- [ ] **Path Rewriting Logic**
  - Input: `.ralph/bin/mcp.js` → Output: `/home/user/ralphy/.ralph/bin/mcp.js`
  - Only `.ralph/` paths are rewritten (not other relative paths)
  - Absolute paths remain unchanged
  - Non-string args are preserved as-is
  
- [ ] **Validation Steps**
  1. Inspect copied `.mcp.json` in worktree
  2. Verify all `.ralph/` references are absolute
  3. Verify non-MCP paths unchanged
  4. Test with `cat` and `jq` to parse JSON

#### 1.3 Missing .mcp.json Handling
- [ ] **No-Op Behavior**
  - If project has no `.mcp.json`, worktree creation succeeds without error
  - No error logs in output
  
- [ ] **Validation Steps**
  1. Temporarily rename `.mcp.json` to `.mcp.json.bak`
  2. Create worktree via agent mode
  3. Verify success (no .mcp.json needed)
  4. Restore `.mcp.json`

#### 1.4 Already-Existing .mcp.json in Worktree
- [ ] **No-Op Behavior**
  - If worktree already has `.mcp.json`, seeding is skipped
  - No overwrite or duplication
  
- [ ] **Validation Steps**
  1. Create worktree manually with existing `.mcp.json`
  2. Run worktree seeding via agent mode
  3. Verify no changes to worktree `.mcp.json`

#### 1.5 Invalid JSON Handling
- [ ] **Graceful Degradation**
  - If `.mcp.json` is malformed, seeding is skipped (no crash)
  - Warning logged (yellow): "! seeding .mcp.json failed..."
  
- [ ] **Validation Steps**
  1. Create invalid `.mcp.json` (corrupt JSON)
  2. Create worktree via agent mode
  3. Verify: warning logged but worktree created successfully
  4. Restore valid `.mcp.json`

---

## 2. Worktree Placement & Management

### Feature: Worktree External Placement

**Purpose:** Place worktrees outside project tree to prevent git conflicts and accidental inclusion.

#### 2.1 Worktree Location
- [ ] **Directory Structure**
  - Worktrees created at: `~/.ralph/<project>/<issue-slug>/worktrees/<branch>`
  - NOT in: `<project-root>/.ralph/worktrees/`
  - NOT in: `<project-root>/worktrees/`
  
- [ ] **Validation Steps**
  1. Run agent mode with Linear issue
  2. Wait for worktree creation
  3. Check: `ls -la ~/.ralph/`
  4. Verify worktree path matches pattern
  5. Verify not in project root: `ls -la .ralph/worktrees/` (should not exist)

#### 2.2 Worktree Cleanup
- [ ] **Cleanup on Success**
  - When task completes successfully, worktree is removed
  - No orphaned directories left
  - Parent directories pruned if empty
  
- [ ] **Validation Steps**
  1. Create and complete a task in agent mode
  2. Verify worktree directory removed: `ls ~/.ralph/<project>/<issue-slug>/`
  3. Check for orphaned `.ralph/<project>/<issue-slug>` (should not exist if empty)

#### 2.3 Cleanup Guard Against Work Loss
- [ ] **Protection Mechanisms**
  - Worktree is not deleted if task failed
  - Worktree is not deleted if `--keep-worktree` flag set
  - User can manually investigate failed worktrees
  
- [ ] **Validation Steps**
  1. Run task with `--max-iterations 1` (likely to fail)
  2. Task fails
  3. Verify worktree still exists: `ls ~/.ralph/<project>/<issue-slug>/`
  4. Verify task can be resumed in same worktree

---

## 3. Agent State Management

### Feature: Unified agent-state.json

**Purpose:** Simplify state management by unifying task state into single map structure.

#### 3.1 State File Structure
- [ ] **State Format**
  - Single `agent-state.json` at project root
  - Tasks stored in flat map: `{ "issue-slug": { state, status, ... }, ... }`
  - No nested per-issue state files
  
- [ ] **Validation Steps**
  1. Run agent mode, create 2-3 tasks
  2. Check: `cat .ralph/agent-state.json`
  3. Verify structure is flat map (not nested)
  4. Verify all active tasks in single file

#### 3.2 State Persistence
- [ ] **State Survives Restarts**
  - Agent mode can be interrupted and resumed
  - All task state preserved in `agent-state.json`
  - No data loss across restarts
  
- [ ] **Validation Steps**
  1. Start agent mode with 3 in-progress tasks
  2. Ctrl+C to interrupt
  3. Wait 5 seconds
  4. Run agent mode again
  5. Verify all 3 tasks resume correctly
  6. Verify no duplicate work

#### 3.3 Deduplication Against State
- [ ] **No Re-Processing**
  - Agent checks `agent-state.json` to avoid re-processing old issues
  - Only new/unprocessed Linear issues trigger new tasks
  
- [ ] **Validation Steps**
  1. Create 2 Linear issues
  2. Run agent mode (both processed, recorded in state)
  3. Stop agent
  4. Run agent again
  5. Verify same 2 issues not re-processed
  6. Create new 3rd issue
  7. Run agent, verify only 3rd issue processed

---

## 4. Hook Failure Recovery

### Feature: Pre-Commit & Pre-Push Hook Failure Handling

**Purpose:** Gracefully handle host git hook failures and retry work.

#### 4.1 Pre-Commit Hook Failures
- [ ] **Recovery Mechanism**
  - Engine encounters pre-commit hook failure during commit
  - Worker detects failure and logs steering advice
  - Writes hook-fix steering to `steering.md` and `tasks.md`
  - Retries operation on next iteration
  
- [ ] **Validation Steps**
  1. Create a project with failing pre-commit hook (e.g., lint failure)
  2. Create task that requires commits
  3. Task hits pre-commit hook failure
  4. Verify: error logged with hook failure message
  5. Verify: `steering.md` contains hook recovery instructions
  6. Verify: task auto-retries and succeeds (if hook fixed)

#### 4.2 Pre-Push Hook Failures
- [ ] **Recovery Mechanism**
  - Engine encounters pre-push hook failure during push
  - Worker detects and logs steering advice
  - Retries push on next iteration
  
- [ ] **Validation Steps**
  1. Create project with failing pre-push hook
  2. Create task that requires pushing
  3. Task hits pre-push hook failure
  4. Verify: hook failure detected and logged
  5. Verify: steering written to recovery file
  6. Verify: retry succeeds (if hook fixed)

#### 4.3 Multiple Failures Threshold
- [ ] **Quarantine After N Failures**
  - After N consecutive identical failures, issue is quarantined
  - Agent stops retrying and moves on
  - User can manually investigate
  
- [ ] **Validation Steps**
  1. Create task with persistent failure (not recoverable)
  2. Run with `--max-failures 5` (default)
  3. Verify failure counted after each iteration
  4. After 5 failures, verify task is quarantined
  5. Verify log message: "quarantining issue..."

---

## 5. Linear Integration Features

### Feature: Linear Issue Prioritization & Filtering

**Purpose:** Smart issue selection for concurrent task loops.

#### 5.1 Priority-Based Issue Picking
- [ ] **Priority Sorting**
  - Agent prioritizes high/urgent issues over medium/low
  - Within same priority, older issues picked first (FIFO)
  - Priority from Linear issue priority field
  
- [ ] **Validation Steps**
  1. Create 5 Linear issues with different priorities:
     - Issue A: Priority 1 (Urgent)
     - Issue B: Priority 2 (Medium)
     - Issue C: Priority 3 (Medium)
     - Issue D: Priority 4 (Low)
     - Issue E: Priority 1 (created after A)
  2. Run agent mode with `--concurrency 2`
  3. Verify work order:
     - A processed first (Urgent, created first)
     - E processed second (Urgent, created after A)
     - B processed before C (FIFO in same priority)
     - D processed last (Low priority)

#### 5.2 Dependency Blocking
- [ ] **Skip Blocked Issues**
  - Agent skips issues blocked by unresolved dependencies
  - Only processes issues with no blocking dependencies
  
- [ ] **Validation Steps**
  1. Create Issue A with no dependencies (active)
  2. Create Issue B depends on A (will block on B)
  3. Run agent mode
  4. Verify Issue A processed
  5. Verify Issue B skipped (due to dependency)
  6. Complete Issue A
  7. Run agent again
  8. Verify Issue B now processed

#### 5.3 Concurrency Control
- [ ] **Concurrent Task Limits**
  - Agent respects `--concurrency N` limit
  - No more than N tasks run simultaneously
  - New tasks queued until slot frees
  
- [ ] **Validation Steps**
  1. Create 5 Linear issues
  2. Run: `ralph agent --linear-team TEST --concurrency 2 --poll-interval 600`
  3. Monitor: `ralph list` (should show 2 in-progress max)
  4. Watch worktrees: `ls ~/.ralph/<project>/*/worktrees/` (2 max)
  5. As tasks complete, new ones auto-start
  6. Verify max concurrency never exceeded

---

## 6. CI & Pull Request Handling

### Feature: PR Creation, CI Monitoring, & Auto-Fix

**Purpose:** Create PRs on success and handle CI failures automatically.

#### 6.1 PR Creation on Task Success
- [ ] **Automatic PR**
  - When task succeeds with `--create-pr`, PR is created
  - PR title matches task name
  - PR description includes task summary
  - PR links back to Linear issue (if applicable)
  
- [ ] **Validation Steps**
  1. Create task with `--create-pr` flag
  2. Complete task successfully
  3. Verify PR created: `gh pr list --state open`
  4. Verify PR title and description
  5. Verify Linear issue linked (if integrated)

#### 6.2 PR Failure Detection
- [ ] **CI Failure Handling**
  - Agent monitors PR checks after creation
  - Detects failed checks
  - With `--fix-ci`, triggers CI fix loop
  
- [ ] **Validation Steps**
  1. Create PR with `--create-pr` flag
  2. Simulate check failure (or wait for real CI to fail)
  3. With `--fix-ci`, verify agent attempts fix
  4. Verify fix loop logs progress
  5. Verify success/failure outcome

#### 6.3 PR Merge on Success
- [ ] **Automated Merge**
  - After all checks pass and approvals met, PR auto-merges
  - Merge method follows project config (merge/squash/rebase)
  
- [ ] **Validation Steps**
  1. Create passing PR
  2. Get approval (if required)
  3. Verify auto-merge triggers (if enabled)
  4. Verify merge completed

#### 6.4 PR Update on Resume
- [ ] **Resume Updates PR**
  - If task resumed after failure, PR updated with new commits
  - PR description updated with latest status
  
- [ ] **Validation Steps**
  1. Create PR with initial task
  2. Task fails mid-way
  3. Interrupt and resume task
  4. Complete task
  5. Verify PR updated with final commits
  6. Verify no duplicate commits

---

## 7. Regression Test Suite

### Critical Regressions to Prevent

#### 7.1 Silent Work Loss
- [ ] **No Data Loss**
  - Git commits not lost during worktree operations
  - State files never corrupted or deleted unexpectedly
  - Task progress preserved across restarts
  
- [ ] **Test Procedure**
  1. Create task with significant changes
  2. Interrupt during execution (Ctrl+C)
  3. Resume task
  4. Verify: all commits preserved
  5. Verify: state file intact and current
  6. Task completes successfully

#### 7.2 Duplicate Issue Processing
- [ ] **No Redundant Work**
  - Agent never processes same issue twice in same run
  - Agent never re-processes archived issues
  
- [ ] **Test Procedure**
  1. Run agent mode with 3 issues
  2. Monitor `agent-state.json` and logs
  3. Verify each issue processed exactly once
  4. Complete all tasks
  5. Restart agent
  6. Verify no re-processing of completed issues

#### 7.3 Concurrent Task Isolation
- [ ] **Task Independence**
  - Multiple concurrent tasks don't interfere
  - Worktree isolation prevents cross-contamination
  - Each task has independent git state
  
- [ ] **Test Procedure**
  1. Run agent with 3 concurrent tasks
  2. Each task in different worktree
  3. Verify commits/changes in task A don't appear in B
  4. Complete all tasks successfully
  5. Verify each PR has only its commits

#### 7.4 Hook Retry Logic
- [ ] **No Infinite Retries**
  - Tasks don't retry indefinitely on hook failures
  - Quarantine kicks in after threshold
  - Logs clearly show retry attempts
  
- [ ] **Test Procedure**
  1. Create task with permanent hook failure
  2. Run with `--max-failures 3`
  3. Monitor iterations and retry counts
  4. After 3 failures, verify quarantine
  5. Verify clear log message

#### 7.5 Worktree Cleanup Safety
- [ ] **Selective Deletion**
  - Failed worktrees NOT deleted (for investigation)
  - Successful worktrees cleaned up
  - No orphaned directories
  
- [ ] **Test Procedure**
  1. Run two tasks (one succeeds, one fails)
  2. Verify failed worktree preserved
  3. Verify successful worktree cleaned
  4. Verify parent dirs pruned if empty

---

## 8. CLI & Configuration Testing

### Feature: CLI Flags & Config File Support

#### 8.1 CLI Flag Parsing
- [ ] **All Flags Recognized**
  - `--name`, `--prompt`, `--claude`, `--max-iterations`
  - `--max-cost`, `--max-runtime`, `--max-failures`
  - `--create-pr`, `--fix-ci`, `--keep-worktree`
  - Agent-specific: `--linear-team`, `--linear-assignee`, `--concurrency`, `--poll-interval`
  
- [ ] **Test Procedure**
  1. Run: `ralph task --help` and verify all flags listed
  2. Run: `ralph agent --help` and verify agent flags listed
  3. Test each flag with valid input
  4. Test invalid flag values (should error gracefully)

#### 8.2 Config File Backing
- [ ] **Config File Fallback**
  - CLI flags override config file values
  - Config file provides defaults
  - First run creates `ralphy.config.json`
  
- [ ] **Test Procedure**
  1. Run: `ralph agent --linear-team ENG --concurrency 5`
  2. Verify `ralphy.config.json` created with values
  3. Edit config file: change `concurrency` to 3
  4. Run: `ralph agent` (no flags)
  5. Verify uses config value (3)
  6. Run: `ralph agent --concurrency 2`
  7. Verify CLI flag overrides config (2)

#### 8.3 Version Display
- [ ] **Version in Help**
  - `ralph --version` shows current version
  - `ralph --help` shows version (optional but nice)
  - Version matches package.json
  
- [ ] **Test Procedure**
  1. Run: `ralph --version`
  2. Verify output format: "v2.10.2" or similar
  3. Verify matches `package.json` version
  4. Run: `ralph --help` and check for version

---

## 9. Edge Cases & Stress Testing

#### 9.1 Large Concurrent Workloads
- [ ] **High Concurrency**
  - Test with `--concurrency 10` (many concurrent tasks)
  - Verify no resource leaks
  - Verify all tasks complete
  
- [ ] **Test Procedure**
  1. Create 15-20 Linear issues
  2. Run: `ralph agent --concurrency 10`
  3. Monitor: CPU, memory (no unbounded growth)
  4. Wait for completion
  5. Verify all tasks succeeded
  6. Verify total cost reasonable

#### 9.2 Long-Running Tasks
- [ ] **Extended Execution**
  - Test with `--max-runtime 60` (1 hour)
  - Verify heartbeat/health checks working
  - Verify periodic Linear updates posted
  
- [ ] **Test Procedure**
  1. Create complex task
  2. Run: `ralph task --max-iterations 50 --max-runtime 60`
  3. Monitor: heartbeat logs every 5 min
  4. Monitor: Linear comments posted (every 10 iterations)
  5. Verify task doesn't run over time limit

#### 9.3 Network Interruptions
- [ ] **Resilience to Flaky Networks**
  - Agent handles temporary API/network failures
  - Retries with backoff (exponential)
  - Doesn't lose state on transient errors
  
- [ ] **Test Procedure**
  1. Simulate network issue (iptables, tc, etc.)
  2. Run agent mode
  3. Observe: retries with backoff in logs
  4. Simulate network recovery
  5. Verify agent continues without losing state

#### 9.4 Rapid Interruption & Resume
- [ ] **Quick Start/Stop Cycles**
  - Agent handles rapid Ctrl+C and restart
  - No state corruption
  - No duplicate work
  
- [ ] **Test Procedure**
  1. Start agent: `ralph agent ...`
  2. Wait 5 seconds, Ctrl+C
  3. Wait 1 second, run again
  4. Repeat 5-10 times
  5. Verify final state correct
  6. Verify no duplicate work

---

## 10. Manual Testing Checklist

### Pre-Testing Setup
- [ ] Environment configured: `LINEAR_API_KEY` set (or mocked)
- [ ] Test Linear workspace/team created
- [ ] Test project cloned with agent-mode capability
- [ ] No active tasks in `agent-state.json`
- [ ] `.ralph/` installed and ready
- [ ] Git configured with test credentials

### Daily Smoke Tests (Run Before Release)
- [ ] **Task Creation**: `ralph task --name test-001 --prompt "test"` succeeds
- [ ] **Task Listing**: `ralph list` shows created task
- [ ] **Task Status**: `ralph status --name test-001` displays correctly
- [ ] **Agent Startup**: `ralph agent --help` shows usage
- [ ] **Config File**: `ralphy.config.json` created on first run
- [ ] **Version Display**: `ralph --version` shows current version

### Feature Testing Log

| Feature | Tested | Passed | Notes | Tester | Date |
|---------|--------|--------|-------|--------|------|
| .mcp.json seeding | [ ] | [ ] | | | |
| Worktree placement | [ ] | [ ] | | | |
| agent-state.json | [ ] | [ ] | | | |
| Hook recovery | [ ] | [ ] | | | |
| Linear prioritization | [ ] | [ ] | | | |
| PR creation | [ ] | [ ] | | | |
| Regression: silent loss | [ ] | [ ] | | | |
| Regression: duplicates | [ ] | [ ] | | | |
| Regression: isolation | [ ] | [ ] | | | |
| Regression: hook logic | [ ] | [ ] | | | |
| CLI flags | [ ] | [ ] | | | |
| Config backing | [ ] | [ ] | | | |
| High concurrency | [ ] | [ ] | | | |

### Final Sign-Off
- [ ] All critical tests passed
- [ ] No new regressions detected
- [ ] Documentation updated (if needed)
- [ ] Release notes prepared
- [ ] PR review completed
- [ ] Ready for release

---

## Appendix: Testing Utilities

### Mock Linear Issues (for testing without real Linear)
```bash
# Create test issues with curl (requires LINEAR_API_KEY)
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query":"mutation { issueCreate(input: {teamId: \"...\", title: \"Test Issue\"}) { issue { id } } }"}'
```

### Inspect Worktree State
```bash
# List all worktrees
ls -la ~/.ralph/

# Show agent state
cat .ralph/agent-state.json | jq .

# Watch worktree creation
watch -n 1 'ls -la ~/.ralph/<project>/<issue>/worktrees/'
```

### Simulate Hook Failures
```bash
# Temporary pre-commit hook that always fails
mkdir -p .git/hooks
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
exit 1
EOF
chmod +x .git/hooks/pre-commit

# Remove failure
rm .git/hooks/pre-commit
```

### Monitor Agent Logs
```bash
# Real-time log tail
tail -f .ralph/agent.log

# Filter for errors/warnings
grep -E "ERROR|WARNING|!" .ralph/agent.log
```

---

## Notes for Test Runners

1. **Environment**: All tests assume a Bun runtime environment. Verify with `bun --version`.

2. **Git State**: Tests modify git state (commits, branches, worktrees). Keep test projects separate from production.

3. **Linear API**: Tests with real Linear require `LINEAR_API_KEY`. Mock issues or use test workspace.

4. **Time**: Full regression suite takes 2-3 hours. Prioritize critical tests if short on time.

5. **Parallel Testing**: Some tests can run in parallel (different issues), others must be sequential (same issue).

6. **Cleanup**: After each test section, clean up:
   - Remove worktrees: `rm -rf ~/.ralph/<project>`
   - Reset state: `rm .ralph/agent-state.json`
   - Archive test PRs (don't leave open)

---

**Version History**
- v1.0 (2026-05-05): Initial release covering v2.10.2 features

