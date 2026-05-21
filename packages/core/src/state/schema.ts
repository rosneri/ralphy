/**
 * Ownership table for the shared per-change `.ralph-state.json`.
 *
 * Each feature writes only its own top-level slot(s). The store enforces
 * this at write time so a careless edit cannot stomp another feature's
 * persisted state. New features must register their slot here before
 * they can write through `writeField`.
 */
export const OWNERSHIP: Record<string, ReadonlyArray<string>> = {
  "linear-attachments": ["specAttachments"],
  "linear-comments": ["linearComments"],
  confirmation: ["confirmation"],
  "review-followup": ["review"],
  "ci-fix": ["ci"],
  implement: ["pr"],
};

export const ALL_OWNED_SLOTS: Set<string> = new Set<string>(
  Object.values(OWNERSHIP).flatMap((slots) => [...slots]),
);
