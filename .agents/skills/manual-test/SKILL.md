---
name: manual-test
description: Run a manual test of the ralph CLI to verify it works end-to-end. Use when you need to smoke test ralph after making changes.
user-invocable: true
argument-hint: [prompt]
---

Run a manual test of the ralph CLI. Execute these commands sequentially:

1. Remove any previous test task:

```bash
rm -rf .ralph/tasks/test
```

2. Build and install the latest code:

```bash
make install
```

3. Run the ralph CLI with a test prompt:

```bash
Codex="" bun run ralph --name "test" --prompt "$ARGUMENTS"
```

If no arguments provided, default to: `"smoke test - do nothing just skip phases"`

4. After the run completes, read `.ralph/tasks/test/state.json` and report:
   - Exit code
   - Final phase and status
   - Total iterations
   - Any errors from the output
