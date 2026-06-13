#!/usr/bin/env bun
/**
 * Stale-change guard (RLF-251)
 *
 * The headless loop is supposed to auto-archive a change once its `tasks.md`
 * is fully checked off. When that archive step fails, the completed change
 * lingers under `openspec/changes/` and the backlog grows silently. This
 * guard reports the completed-but-unarchived backlog and fails CI when it
 * exceeds a fixed threshold.
 *
 * The threshold is a RATCHET: it is seeded at the current backlog so the
 * guard fires only if the backlog GROWS. As the backlog is drained (run
 * `bun scripts/archive-completed-changes.ts`), lower THRESHOLD to match —
 * never raise it.
 */

import { join } from "node:path";

import { findStaleChanges } from "../packages/core/src/stale-changes";

// Current completed-but-unarchived backlog. Lower this as changes are
// archived; never raise it.
const THRESHOLD = 86;

const REPO_ROOT = join(import.meta.dirname, "..");

async function checkStaleBacklog(): Promise<void> {
  const stale = await findStaleChanges({ cwd: REPO_ROOT });

  if (stale.length === 0) {
    console.log("✓ No completed-but-unarchived changes");
    return;
  }

  console.log(`Completed-but-unarchived changes (${stale.length}):\n`);
  for (const name of stale) {
    console.log(`  ${name}`);
  }

  if (stale.length > THRESHOLD) {
    console.error(
      `\n✘ Stale-change backlog (${stale.length}) exceeds threshold (${THRESHOLD}).` +
        `\nArchive completed changes with: bun scripts/archive-completed-changes.ts`,
    );
    process.exit(1);
  }

  console.log(`\n✓ Backlog (${stale.length}) within threshold (${THRESHOLD}).`);
}

await checkStaleBacklog();
