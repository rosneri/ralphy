#!/usr/bin/env bun
/**
 * Apply branch protection (RLF-261).
 *
 * Writes the branch-protection rule from `branch-protection.config.ts` to
 * GitHub via `gh api`, making the `ci` status check a required, non-bypassable
 * gate on `main`. Run by a maintainer with `gh` authenticated:
 *
 *   bun scripts/apply-branch-protection.ts
 *
 * `enforce_admins: true` means even repository admins cannot merge a PR whose
 * `ci` check is red — the gate cannot be bypassed.
 *
 * Bun-native: uses `Bun.spawn`, no `node:child_process`.
 */

import { BRANCH, ENFORCE_ADMINS, REQUIRED_CHECKS, STRICT } from "./branch-protection.config";
import { resolveRepoSlug, runGh } from "./lib/gh";

export function buildProtectionPayload(): string {
  return JSON.stringify({
    required_status_checks: {
      strict: STRICT,
      contexts: [...REQUIRED_CHECKS],
    },
    enforce_admins: ENFORCE_ADMINS,
    required_pull_request_reviews: null,
    restrictions: null,
  });
}

async function applyBranchProtection(): Promise<void> {
  const repo = await resolveRepoSlug();
  const payload = buildProtectionPayload();

  console.log(`Applying branch protection to ${repo}@${BRANCH}…`);
  const result = await runGh(
    ["api", "-X", "PUT", `repos/${repo}/branches/${BRANCH}/protection`, "--input", "-"],
    payload,
  );

  if (result.code !== 0) {
    console.error(`Failed to apply branch protection:\n${result.stderr || result.stdout}`);
    process.exit(1);
  }

  console.log(
    `Branch protection applied: ${BRANCH} now requires [${REQUIRED_CHECKS.join(", ")}] ` +
      `(strict=${STRICT}, enforce_admins=${ENFORCE_ADMINS}).`,
  );
}

if (import.meta.main) {
  await applyBranchProtection();
}
