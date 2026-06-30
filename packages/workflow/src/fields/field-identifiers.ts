/**
 * Reserved control field ids. These are dotted config paths (or, for the
 * control fields, synthetic ids) that the wizard, builder, and migrations all
 * reference by name rather than by magic string.
 */

/** Reserved field id whose value is the prompt body, not a frontmatter setting. */
export const PROMPT_BODY_FIELD_ID = "promptBody";

/**
 * Control field id: a confirm that decides whether the detected `repo` block is
 * written. Its own value is never persisted — the builder strips it and uses it
 * to gate the `repo.*` answers (see `buildFromAnswers`).
 */
export const REPO_LINK_FIELD_ID = "repo.link";

/**
 * Control field ids: how to filter Linear tickets by assignee. The select value
 * (`me` / `any` / `unassigned` / `other`) and the optional specific-user value
 * are combined by the builder into the single `linear.filter` expression — the
 * choice/value ids are never written as frontmatter keys (see `buildFromAnswers`).
 */
export const LINEAR_ASSIGNEE_CHOICE_FIELD_ID = "linear.assigneeChoice";
export const LINEAR_ASSIGNEE_VALUE_FIELD_ID = "linear.assigneeValue";
