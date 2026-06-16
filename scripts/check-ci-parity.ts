#!/usr/bin/env bun
/**
 * CI ↔ Local-hook parity guard (RLF-261).
 *
 * Closes the "local hooks are stricter than CI" gap: any `scripts/check-*`
 * guard a developer runs locally (husky pre-commit or pre-push) MUST also run
 * in `.github/workflows/ci.yml`, otherwise code that passes locally can still
 * regress something CI never re-checks — or worse, a check is silently dropped
 * from CI while developers keep trusting their green local run.
 *
 * Two invariants are enforced:
 *   1. local gates ⊆ CI      — every check in pre-commit/pre-push runs in CI.
 *   2. CI ⊆ local ∪ allowlist — every CI check is reachable locally, unless it
 *                               is an explicitly allowlisted CI-only check.
 *
 * Indirection through package.json scripts is resolved, so `bun run check:shell`
 * counts as the underlying `scripts/check-shell.sh`.
 *
 * Bun-native: uses `Bun.file`, no `node:fs` sync APIs.
 */

import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * CI-only checks: present in CI but intentionally NOT wired into the husky
 * hooks (too slow, network-bound, or self-referential). Each is allowed to live
 * in CI without a local equivalent.
 */
export const CI_ONLY_ALLOWLIST: ReadonlySet<string> = new Set([
  "check-outdated", // network-bound dependency drift; not worth a per-commit hit
  "check-duplicate-declarations", // runs in pre-push (not pre-commit) + CI
  "check-ci-local-sync", // meta-check comparing ci.yml ↔ ci-local.sh
  "check-ci-parity", // this guard itself
  "check-branch-protection", // opt-in drift check; needs gh auth, not in default CI
]);

const DIRECT_CHECK_RE = /scripts\/(check-[a-z0-9-]+)\.(?:ts|sh)/g;
const RUN_SCRIPT_RE = /\b(?:bun|npm|pnpm|yarn)\s+run\s+([\w:-]+)/g;

/**
 * Extract the set of `check-*` script basenames referenced by a command blob,
 * resolving `bun run <script>` indirection recursively through package.json.
 */
export function extractChecks(
  text: string,
  pkgScripts: Record<string, string>,
  seen: Set<string> = new Set(),
): Set<string> {
  const checks = new Set<string>();

  for (const match of text.matchAll(DIRECT_CHECK_RE)) {
    checks.add(match[1]!);
  }

  for (const match of text.matchAll(RUN_SCRIPT_RE)) {
    const scriptName = match[1]!;
    if (seen.has(scriptName)) continue;
    seen.add(scriptName);
    const body = pkgScripts[scriptName];
    if (!body) continue;
    for (const nested of extractChecks(body, pkgScripts, seen)) {
      checks.add(nested);
    }
  }

  return checks;
}

export interface ParityInput {
  preCommit: Set<string>;
  prePush: Set<string>;
  ci: Set<string>;
  allowlist: ReadonlySet<string>;
}

export interface ParityResult {
  /** Local-gate checks (pre-commit ∪ pre-push) absent from CI — invariant 1 break. */
  missingInCi: string[];
  /** CI checks neither reachable locally nor allowlisted — invariant 2 break. */
  unexpectedInCi: string[];
}

export function computeParity(input: ParityInput): ParityResult {
  const localGates = new Set<string>([...input.preCommit, ...input.prePush]);

  const missingInCi = [...localGates].filter((c) => !input.ci.has(c)).sort();
  const unexpectedInCi = [...input.ci]
    .filter((c) => !localGates.has(c) && !input.allowlist.has(c))
    .sort();

  return { missingInCi, unexpectedInCi };
}

async function readText(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) return "";
  return file.text();
}

export async function gatherSets(repoRoot: string): Promise<{
  preCommit: Set<string>;
  prePush: Set<string>;
  ci: Set<string>;
}> {
  const pkgRaw = await readText(join(repoRoot, "package.json"));
  const pkgScripts: Record<string, string> = pkgRaw ? (JSON.parse(pkgRaw).scripts ?? {}) : {};

  const preCommitSrc = await readText(join(repoRoot, ".husky", "pre-commit"));
  const prePushSrc = await readText(join(repoRoot, ".husky", "pre-push"));
  const ciSrc = await readText(join(repoRoot, ".github", "workflows", "ci.yml"));

  return {
    preCommit: extractChecks(preCommitSrc, pkgScripts),
    prePush: extractChecks(prePushSrc, pkgScripts),
    ci: extractChecks(ciSrc, pkgScripts),
  };
}

async function main(): Promise<void> {
  const { preCommit, prePush, ci } = await gatherSets(REPO_ROOT);
  const { missingInCi, unexpectedInCi } = computeParity({
    preCommit,
    prePush,
    ci,
    allowlist: CI_ONLY_ALLOWLIST,
  });

  if (missingInCi.length === 0 && unexpectedInCi.length === 0) {
    console.log(
      `CI ↔ local parity holds: ${ci.size} CI checks, ${preCommit.size} pre-commit, ${prePush.size} pre-push.`,
    );
    process.exit(0);
  }

  if (missingInCi.length > 0) {
    console.error("Local hooks run checks that CI does NOT (local is stricter than CI):\n");
    for (const name of missingInCi) {
      console.error(`  - ${name}`);
    }
    console.error("\nAdd a matching step to .github/workflows/ci.yml (and scripts/ci-local.sh).\n");
  }

  if (unexpectedInCi.length > 0) {
    console.error(
      "CI runs checks that are not reachable via a local hook and are not allowlisted:\n",
    );
    for (const name of unexpectedInCi) {
      console.error(`  - ${name}`);
    }
    console.error(
      "\nEither wire the check into a husky hook, or add it to CI_ONLY_ALLOWLIST with a reason.",
    );
  }

  process.exit(1);
}

if (import.meta.main) {
  await main();
}
