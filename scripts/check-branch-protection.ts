#!/usr/bin/env bun
/**
 * Branch-protection drift check (RLF-261).
 *
 * Opt-in guard (NOT wired into default CI — it needs an authenticated `gh`).
 * Fetches the live branch-protection rule on `main` and diffs it against
 * `branch-protection.config.ts`, failing if the required `ci` check, the strict
 * flag, or admin enforcement has drifted.
 *
 *   bun scripts/check-branch-protection.ts
 *
 * Bun-native: uses `Bun.spawn`, no `node:child_process`.
 */

import { BRANCH, ENFORCE_ADMINS, REQUIRED_CHECKS, STRICT } from "./branch-protection.config";
import { resolveRepoSlug, runGh } from "./lib/gh";

interface LiveProtection {
  required_status_checks?: { strict?: boolean; contexts?: string[] } | null;
  enforce_admins?: { enabled?: boolean } | boolean | null;
}

export function diffProtection(live: LiveProtection): string[] {
  const drift: string[] = [];

  const liveContexts = new Set(live.required_status_checks?.contexts ?? []);
  for (const required of REQUIRED_CHECKS) {
    if (!liveContexts.has(required)) {
      drift.push(`required status check "${required}" is missing`);
    }
  }

  const liveStrict = live.required_status_checks?.strict ?? false;
  if (liveStrict !== STRICT) {
    drift.push(`strict should be ${STRICT}, live is ${liveStrict}`);
  }

  const liveEnforceAdmins =
    typeof live.enforce_admins === "boolean"
      ? live.enforce_admins
      : (live.enforce_admins?.enabled ?? false);
  if (liveEnforceAdmins !== ENFORCE_ADMINS) {
    drift.push(`enforce_admins should be ${ENFORCE_ADMINS}, live is ${liveEnforceAdmins}`);
  }

  return drift;
}

async function checkBranchProtection(): Promise<void> {
  const repo = await resolveRepoSlug();
  const result = await runGh(["api", `repos/${repo}/branches/${BRANCH}/protection`]);

  if (result.code !== 0) {
    console.error(
      `Could not read branch protection for ${repo}@${BRANCH} — is it configured?\n` +
        `${result.stderr || result.stdout}\n\nRun: bun scripts/apply-branch-protection.ts`,
    );
    process.exit(1);
  }

  const live = JSON.parse(result.stdout) as LiveProtection;
  const drift = diffProtection(live);

  if (drift.length === 0) {
    console.log(`Branch protection on ${repo}@${BRANCH} matches branch-protection.config.ts.`);
    process.exit(0);
  }

  console.error(`Branch protection on ${repo}@${BRANCH} has drifted:\n`);
  for (const item of drift) {
    console.error(`  - ${item}`);
  }
  console.error("\nRun: bun scripts/apply-branch-protection.ts");
  process.exit(1);
}

if (import.meta.main) {
  await checkBranchProtection();
}
