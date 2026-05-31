import { createActor } from "xstate";
import { createMachineInspector } from "./inspector";
import { issueFlowMachine } from "./issue-flow.machine";

export type { IssueFlowContext, IssueFlowEvent } from "./issue-flow.machine";

export function createIssueFlowActor(issueId: string) {
  const inspector = createMachineInspector();
  if (inspector) {
    return createActor(issueFlowMachine, { input: { issueId }, inspect: inspector });
  }
  return createActor(issueFlowMachine, { input: { issueId } });
}
