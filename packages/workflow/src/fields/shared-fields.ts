import type { Field } from "../fields";
import {
  LINEAR_ASSIGNEE_CHOICE_FIELD_ID,
  LINEAR_ASSIGNEE_VALUE_FIELD_ID,
} from "./field-identifiers";
import { yes } from "./field-spec-builders";

export const PROJECT_NAME: Field = {
  id: "project.name",
  label: "Project name",
  description: "The project's display name. Ralphy puts it in the agent's prompt and in its logs.",
  spec: { kind: "text", placeholder: "my-project" },
};

export const LINEAR_TEAM: Field = {
  id: "linear.team",
  label: "Linear team key",
  hint: "e.g. ENG — leave blank to match all teams",
  description:
    "The Linear team this repository is linked to, given by its key (e.g. ENG). Ralphy only picks up issues from this team. Leave blank to watch every team.",
  emptyLabel: "all teams",
  spec: { kind: "text" },
};

/**
 * Shown only when `ralphy init` detected the current git repo (its `repo.name`
 * is injected as an initial value). Confirming records the detected repo in
 * WORKFLOW.md and links it to the Linear team; declining omits the `repo` block.
 * `repo.link` is a control answer — it is never written to the file (see
 * `buildFromAnswers`), so it carries a description without a real frontmatter key.
 */
export const REPO_LINK: Field = {
  id: "repo.link",
  label: "Record this repository in WORKFLOW.md?",
  description:
    "Record the detected git repository in WORKFLOW.md so Ralphy maps this project's Linear issues to it. Confirm to adopt the detected repo; decline to leave it out.",
  spec: yes(),
  when: (answers) => typeof answers["repo.name"] === "string" && answers["repo.name"] !== "",
};

/** Comment stamped above `linear.filter` in a generated WORKFLOW.md. */
export const LINEAR_FILTER_DESCRIPTION =
  "Global filter ANDed into every Linear ticket fetch: a marker list of 'assignee' and " +
  "'label' clauses (all required). assignee value is 'me' (assigned to you), 'any' " +
  "(regardless of assignee), 'unassigned', or a specific Linear user (email or user-id). " +
  "Add 'label' clauses to require the ticket carry those labels. Defaults to assignee = me.";

export const LINEAR_ASSIGNEE_CHOICE: Field = {
  id: LINEAR_ASSIGNEE_CHOICE_FIELD_ID,
  label: "Linear assignee filter",
  description:
    "Which Linear issues Ralphy fetches, by assignee: 'me' (assigned to you), 'any' (regardless of assignee), 'unassigned', or a specific user you name next.",
  spec: {
    kind: "select",
    options: [
      { label: "me (assigned to you)", value: "me" },
      { label: "any (regardless of assignee)", value: "any" },
      { label: "unassigned", value: "unassigned" },
      { label: "a specific user (email or user-id)…", value: "other" },
    ],
  },
};

export const LINEAR_ASSIGNEE_VALUE: Field = {
  id: LINEAR_ASSIGNEE_VALUE_FIELD_ID,
  label: "Assignee email or user-id",
  description: "The specific Linear user to filter by — their email address or Linear user-id.",
  spec: { kind: "text", placeholder: "you@example.com" },
  when: (answers) => answers[LINEAR_ASSIGNEE_CHOICE_FIELD_ID] === "other",
};
