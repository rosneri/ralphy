# Spec: Serialized JSON log writes

## MODIFIED Requirements

### Requirement: logJsonEvent serializes writes per path

All writes to the same `logFile` path MUST be serialized through a per-path promise chain so that concurrent calls cannot interleave bytes and every call produces exactly one complete JSONL line.

#### Scenario: many concurrent logJsonEvent calls all appear in output

Given `logJsonEvent` is called 100 times in rapid succession on the same file path,
when `flushJsonLog` resolves,
then the file MUST contain exactly 100 complete JSONL lines with no interleaved bytes.

## ADDED Requirements

### Requirement: flushJsonLog drains pending writes

`flushJsonLog(logFile: string): Promise<void>` MUST resolve when all pending `logJsonEvent` writes to `logFile` are complete.

#### Scenario: flushJsonLog resolves after all writes

Given multiple `logJsonEvent` calls have been made,
when `await flushJsonLog(logFile)` resolves,
then all previously queued lines MUST be present in the file.

### Requirement: initWorkerLog resets the write chain

`initWorkerLog` MUST reset the per-path write chain for `logFile` after truncating, preventing stale promises from a prior run from interfering.

#### Scenario: initWorkerLog clears prior chain

Given a prior chain of `logJsonEvent` calls exists for a path,
when `await initWorkerLog(path)` completes,
then subsequent `logJsonEvent` calls MUST write only to the freshly truncated file.
