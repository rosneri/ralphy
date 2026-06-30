import type { WizardValue } from "../wizard-types";

export const isOn =
  (id: string) =>
  (answers: Record<string, WizardValue>): boolean =>
    answers[id] === true;

/** Gate for the GitHub Issues sub-options — only asked when GitHub is the tracker. */
export const trackerIsGithub = (answers: Record<string, WizardValue>): boolean =>
  answers["tracker.kind"] === "github";

/**
 * Concurrency > 1 forces isolated git worktrees on — parallel tasks each need
 * their own working copy or they clobber each other's files. The wizard hides
 * the worktree toggle once concurrency > 1 (it is no longer optional) and the
 * builder writes `useWorktree: true`; the runtime enforces the same invariant.
 */
export const concurrencyForcesWorktree = (answers: Record<string, WizardValue>): boolean => {
  const value = answers["concurrency"];
  return typeof value === "number" && value > 1;
};

/** Worktrees are effectively enabled when chosen OR forced by concurrency. */
export const worktreeEnabled = (answers: Record<string, WizardValue>): boolean =>
  answers["useWorktree"] === true || concurrencyForcesWorktree(answers);
