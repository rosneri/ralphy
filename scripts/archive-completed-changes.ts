#!/usr/bin/env bun
/**
 * Maintenance: archive completed-but-unarchived OpenSpec changes (RLF-251)
 *
 * Opt-in, run by a human. Archives every change whose `tasks.md` is fully
 * checked off via the same `OpenSpecChangeStore.archiveChange` entry point
 * the headless loop uses. Incomplete changes are never in the stale list,
 * so they are never force-archived.
 *
 * Defensive: a single archive failure does not abort the run. Failures are
 * collected and reported alongside a `archived N, skipped M` summary.
 *
 *   bun scripts/archive-completed-changes.ts
 */

import { OpenSpecChangeStore } from "../packages/openspec/src/openspec-change-store";
import { findStaleChanges } from "../packages/core/src/stale-changes";

interface Result {
  name: string;
  ok: boolean;
  error?: string;
}

async function archiveCompletedChanges(): Promise<void> {
  const stale = await findStaleChanges();

  if (stale.length === 0) {
    console.log("No completed-but-unarchived changes — nothing to do.");
    return;
  }

  console.log(`Archiving ${stale.length} completed change(s)...\n`);

  const store = new OpenSpecChangeStore();
  const results: Result[] = [];

  for (const name of stale) {
    try {
      await store.archiveChange(name);
      results.push({ name, ok: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name, ok: false, error: message });
      console.error(`  ✘ ${name}: ${message}`);
    }
  }

  const archived = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\narchived ${archived}, skipped ${failed.length}`);
  for (const f of failed) {
    console.log(`  skipped ${f.name}: ${f.error}`);
  }
}

await archiveCompletedChanges();
