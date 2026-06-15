/**
 * Branch-protection-as-code (RLF-261).
 *
 * Single source of truth for the GitHub branch-protection rule that makes the
 * `ci` status check a required, non-bypassable gate on `main`. Consumed by
 * `apply-branch-protection.ts` (writes the rule) and `check-branch-protection.ts`
 * (drifts the live rule against this config).
 */

/** Branch the protection rule applies to. */
export const BRANCH = "main";

/**
 * Status checks that MUST pass before a PR can merge. Matches the `ci` job in
 * `.github/workflows/ci.yml`; keep them aligned.
 */
export const REQUIRED_CHECKS: readonly string[] = ["ci"];

/** Require branches to be up to date with the base before merging. */
export const STRICT = true;

/** Apply protection to admins too — makes the gate non-bypassable. */
export const ENFORCE_ADMINS = true;
