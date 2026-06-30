import type { Field } from "../fields";
import {
  LINEAR_ASSIGNEE_CHOICE,
  LINEAR_ASSIGNEE_VALUE,
  LINEAR_TEAM,
  PROJECT_NAME,
  REPO_LINK,
} from "./shared-fields";

export const QUICK_FIELDS: Field[] = [
  PROJECT_NAME,
  LINEAR_TEAM,
  REPO_LINK,
  LINEAR_ASSIGNEE_CHOICE,
  LINEAR_ASSIGNEE_VALUE,
];
