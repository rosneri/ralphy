# file-size-guardrail — ratcheting per-file LOC budget

## ADDED Requirements

### Requirement: per-file LOC guardrail with a grandfather baseline

The system MUST provide `scripts/check-file-size.ts` that fails CI when a production source file exceeds the line budget unless it is grandfathered by a committed baseline.

The script MUST scan production source files under `packages/*/src/**/*.{ts,tsx}`
and `apps/*/src/**/*.{ts,tsx}`, excluding `*.test.ts(x)`, `*.spec.ts(x)`,
`**/__tests__/**`, `**/dist/**`, `**/generated/**`, and `**/__fixtures__/**`.

For each scanned file it MUST count lines and compare files whose count exceeds
`MAX_LINES` (400) against `scripts/.file-size-baseline.json`. A file is a
violation if it exceeds the budget AND is either absent from the baseline OR
recorded in the baseline with a smaller count than its current count. The script
MUST print each offender with its current and recorded counts and exit non-zero
when any violation exists; otherwise it MUST exit zero.

The check MUST run from `package.json`'s `check:structure` script and from a
dedicated CI step in `.github/workflows/ci.yml`.

#### Scenario: a new file over budget fails

- **Given** a source file of 401 lines that is absent from the baseline
- **When** `check-file-size` runs
- **Then** the file is reported as a violation and the check exits non-zero

#### Scenario: a baselined file that grew fails

- **Given** a file recorded in the baseline at 1112 lines that now has 1113 lines
- **When** `check-file-size` runs
- **Then** the file is reported as a violation and the check exits non-zero

#### Scenario: a baselined file that shrank passes

- **Given** a file recorded in the baseline at 1112 lines that now has 900 lines
- **When** `check-file-size` runs
- **Then** the file is not a violation and the check exits zero

#### Scenario: a file under budget passes

- **Given** a source file of 400 or fewer lines that is absent from the baseline
- **When** `check-file-size` runs
- **Then** the file is not a violation and the check exits zero

#### Scenario: the current tree passes after the baseline is committed

- **Given** the initial baseline generated from today's offenders is committed
- **When** `bun scripts/check-file-size.ts` runs on the unmodified tree
- **Then** it exits zero

### Requirement: baseline ratchets down only

The system MUST support an `--update` mode that rewrites `scripts/.file-size-baseline.json` so that existing entries are only lowered, never raised.

In `--update` mode the script MUST include every over-budget file in the new
baseline. For a file already present in the baseline, the recorded value MUST be
`min(current count, existing recorded count)`. Files that fall to or below the
budget MUST be dropped from the baseline. The script MUST NOT raise any existing
entry above its previously recorded value.

#### Scenario: update lowers a shrunk entry

- **Given** a baseline recording a file at 1112 lines and the file now has 900 lines (still over budget)
- **When** the script runs in `--update` mode
- **Then** the new baseline records that file at 900 lines

#### Scenario: update never raises a grown entry

- **Given** a baseline recording a file at 1112 lines and the file now has 1200 lines
- **When** the script runs in `--update` mode
- **Then** the new baseline still records that file at 1112 lines

#### Scenario: update drops a file that fell under budget

- **Given** a baseline recording a file at 420 lines and the file now has 390 lines
- **When** the script runs in `--update` mode
- **Then** the file is absent from the new baseline
