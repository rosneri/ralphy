import type { Bus, EmitInput } from "@ralphy/events";
import type { LinearIssue } from "../agent/linear";
import { PollContext } from "../shared/capabilities/poll-context";
import type { FeatureCtx } from "../features/types";

/** Test-only Bus that captures emit() calls into the provided array.
 *  Properly satisfies the Bus interface so callers do not need any
 *  unsafe cast. `on` returns a no-op unsubscribe and `snapshot`
 *  returns an empty list; both are unused by feature code paths that
 *  only emit. */
export function recordingBus(events: EmitInput[]): Bus {
  return {
    emit(e: EmitInput): void {
      events.push(e);
    },
    on(): () => void {
      return () => {};
    },
    snapshot() {
      return [];
    },
  };
}

const FAKE_ISSUE: LinearIssue = {
  id: "issue-bare",
  identifier: "BARE-0",
  title: "bare",
  description: null,
  url: "https://example/BARE-0",
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
  priority: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
};

/** Minimal FeatureCtx for tests whose detect/run signatures do not touch
 *  ctx fields. Lets callers avoid unsafe casts on the ctx parameter. */
export function makeBareCtx(): FeatureCtx {
  return {
    issue: FAKE_ISSUE,
    worktree: "/tmp",
    state: { writeField: async () => {} },
    bus: recordingBus([]),
    caps: { gh: null, linear: null, git: null, fsChange: null, worker: null },
    poll: new PollContext(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
}
