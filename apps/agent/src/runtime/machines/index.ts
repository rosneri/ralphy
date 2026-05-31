import { createActor } from "xstate";
import { createMachineInspector } from "./inspector";
import { issueFlowMachine } from "./issue-flow.machine";

export { issueFlowMachine };
export type { IssueFlowContext, IssueFlowEvent } from "./issue-flow.machine";

export function createIssueFlowActor(issueId: string) {
  return createActor(issueFlowMachine, {
    input: { issueId },
    inspect: createMachineInspector(),
  });
}
