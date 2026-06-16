# Contributing

## Quality gates

Ralphy enforces the same static, test, and build checks in three places. They are
deliberately kept in lockstep so a green local run means a green CI run.

| Surface             | What runs it                              | What it runs                                                    |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| **pre-commit**      | `.husky/pre-commit`                       | `lint-staged`, `bun run check:structure`, `bun run check:shell` |
| **pre-push**        | `.husky/pre-push`                         | `bun scripts/check-duplicate-declarations.ts`                   |
| **CI**              | `.github/workflows/ci.yml` (the `ci` job) | every check above, plus lint/format/typecheck/test/build        |
| **local CI mirror** | `scripts/ci-local.sh`                     | a 1:1 mirror of the CI job, for running CI locally              |

Run the full CI suite locally before pushing:

```sh
bun scripts/ci-local.sh          # all stages
bun scripts/ci-local.sh static   # static checks only
```

## The parity guarantee

Two guards keep these surfaces honest, and both run inside CI:

- **`scripts/check-ci-local-sync.ts`** — every actionable step in `ci.yml` has a
  matching `run_step` in `ci-local.sh` (or is annotated `# local-ci: skip`).
- **`scripts/check-ci-parity.ts`** — every `scripts/check-*` guard a developer
  runs locally (pre-commit or pre-push) also runs in CI, and every CI check is
  either reachable from a local hook or listed in `CI_ONLY_ALLOWLIST` with a
  reason. This closes the "local hooks are stricter than CI" gap: a check can
  never be dropped from CI while developers keep trusting their green local run.

If you add a `check-*` script to a husky hook, wire it into `ci.yml` and
`ci-local.sh` too (with identical step names) — otherwise the parity guard fails.

## Required status check

`main` is protected so that the `ci` status check must pass before any pull
request can merge. The rule lives as code in `scripts/branch-protection.config.ts`
(`REQUIRED_CHECKS = ["ci"]`, `BRANCH = "main"`).

Apply or update the rule (maintainers, with `gh` authenticated):

```sh
bun scripts/apply-branch-protection.ts
```

This sets `enforce_admins: true`, which makes the gate **non-bypassable** — even
repository admins cannot merge a pull request whose `ci` check is red.

Verify the live rule still matches the config (opt-in; needs `gh` auth, so it is
intentionally **not** part of the default CI run):

```sh
bun scripts/check-branch-protection.ts
```
