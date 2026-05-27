# testing — integration tests for state store and OpenSpec lifecycle

## ADDED Requirements

### Requirement: state store integration tests covering S5.1–S5.5 MUST exist and pass

`packages/core/src/__tests__/state-store-integration.test.ts` MUST contain integration tests that exercise the single-writer-per-field ownership model and state-file lifecycle under realistic multi-step workflows.

#### Scenario S5.1: two feature owners write to different slots without interference

- **Given** a fresh change directory with no `.ralph-state.json`
- **When** `writeField(dir, "linear-attachments", "specAttachments.proposal", {...})` is called
- **And** `writeField(dir, "linear-comments", "linearComments.planCommentId", "c-1")` is called
- **Then** both slots are present and correct in `.ralph-state.json`
- **And** neither write has stomped the other's data

#### Scenario S5.2: unknown fields in `.ralph-state.json` survive a `writeField` round-trip

- **Given** `.ralph-state.json` contains extra top-level fields not in any feature's OWNERSHIP table
- **When** an owning feature writes to its registered slot via `writeField`
- **Then** the extra fields are preserved verbatim in the file after the write

#### Scenario S5.3: corrupted `.ralph-state.json` is handled gracefully

- **Given** `.ralph-state.json` contains syntactically invalid JSON
- **When** `tryReadStateRaw(changeDir)` is called
- **Then** it returns `{ state: null, raw: null }` without throwing
- **When** `writeField(changeDir, featureName, path, value)` is called on the same corrupted file
- **Then** it silently re-initialises the file and writes the new field without throwing

#### Scenario S5.4: direct disk mutation between iterations is visible on the next read

- **Given** `.ralph-state.json` was written by `writeField`
- **When** an external process overwrites `.ralph-state.json` with different content
- **And** `writeField` is called again with an owned field
- **Then** the externally-added content is preserved alongside the new field

#### Scenario S5.5: all registered feature slots accumulate without interference

- **Given** a fresh change directory
- **When** every registered feature (`linear-attachments`, `linear-comments`, `confirmation`, `review-followup`, `ci-fix`, `implement`) writes to its own slot
- **Then** all six slots are present and correct in the resulting `.ralph-state.json`

---

### Requirement: OpenSpec lifecycle integration tests covering S9.1–S9.7 MUST exist and pass

`packages/openspec/src/__tests__/openspec-lifecycle-integration.test.ts` MUST contain integration tests that exercise `OpenSpecChangeStore` against varied `openspec/changes/<name>/` directory layouts.

#### Scenario S9.1: missing openspec/changes directory

- **Given** the `openspec/changes` directory does not exist
- **When** `listChanges()` is called
- **Then** it returns an empty array without throwing

#### Scenario S9.2: empty tasks.md file

- **Given** `openspec/changes/<name>/tasks.md` exists but is empty
- **When** `readTaskList(name)` is called
- **Then** it returns an empty string

#### Scenario S9.3: writeTaskList/readTaskList round-trip

- **Given** `writeTaskList(name, content)` is called with multi-section content
- **When** `readTaskList(name)` is called immediately after
- **Then** the returned string equals the content that was written

#### Scenario S9.4: unicode change names

- **Given** a change directory whose name contains unicode characters (e.g., `rlf-110-café-☕`)
- **When** `listChanges()` is called
- **Then** the unicode name appears in the returned array
- **When** `readTaskList(unicodeName)` is called on a tasks.md with unicode content
- **Then** the unicode content is returned correctly

#### Scenario S9.5: prefix/suffix name collision

- **Given** two change directories named `my-feature` and `my-feature-v2`
- **When** `listChanges()` is called
- **Then** both names appear in the result and no entries are missing or merged

#### Scenario S9.6: writeTaskList creates the change directory automatically

- **Given** the change directory does not exist
- **When** `writeTaskList(name, content)` is called
- **Then** the directory is created and the file is written without throwing

#### Scenario S9.7: archive directory excluded from listChanges

- **Given** `openspec/changes/archive/` is present alongside real change directories
- **When** `listChanges()` is called
- **Then** `"archive"` does not appear in the result
- **And** change names nested inside `archive/` do not appear in the result
