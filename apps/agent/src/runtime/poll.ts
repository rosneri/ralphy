import { route as routerRoute } from "./router";
import type { FlowAssignment, RouterSignals } from "./types";

/**
 * `pollOnce` deps. Each stage is a plain async function so callers can
 * wire in either the existing capabilities (Linear fetch, pure
 * detections) or unit-test fakes.
 */
interface PollDeps<Issue = unknown, Context = unknown> {
  gather: () => Promise<Issue[]>;
  classify: (issues: readonly Issue[]) => Promise<RouterSignals[]> | RouterSignals[];
  route?: (signals: RouterSignals) => FlowAssignment;
  execute: (
    assignments: readonly { signals: RouterSignals; assignment: FlowAssignment }[],
    context?: Context,
  ) => Promise<void>;
}

/** Drives one poll cycle: `gather → classify → route → execute`. */
export async function pollOnce<I, C>(deps: PollDeps<I, C>, context?: C): Promise<void> {
  const route = deps.route ?? routerRoute;
  const issues = await deps.gather();
  const signals = await deps.classify(issues);
  const assignments = signals.map((s) => ({ signals: s, assignment: route(s) }));
  await deps.execute(assignments, context);
}
