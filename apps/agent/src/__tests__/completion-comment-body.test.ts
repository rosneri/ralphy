import { describe, expect, test } from "bun:test";
import { parseRalphyMarker } from "@ralphy/comms";
import { completionCommentBody } from "../runtime/coordinator";
import type { QueueTrigger } from "../queue/queue-order";

/**
 * BAN-799 regression guard. The completion comment must reflect the flow
 * actor's REAL post-exit state, not just "the worker subprocess exited 0".
 * The bug: every successful worker exit (including ci-fix re-runs and review
 * passes that leave the ticket resting in `awaiting-ci`) posted "completed
 * work", so a PR that was still draft / red / unapproved / unmerged looked
 * done. "completed" is now emitted ONLY when `reachedDone` is true.
 */

const CHANGE = "ban-799-remove-flow-of-funds-intercom-error";

function build(args: {
  trigger: QueueTrigger;
  reachedDone: boolean;
  ok?: boolean;
  noChanges?: boolean;
  code?: number;
}): { type: string; body: string } {
  const body = completionCommentBody({
    noChanges: args.noChanges ?? false,
    ok: args.ok ?? true,
    trigger: args.trigger,
    changeName: CHANGE,
    code: args.code ?? 0,
    reachedDone: args.reachedDone,
  });
  const marker = parseRalphyMarker(body);
  expect(marker).not.toBeNull();
  return { type: marker!.type, body };
}

describe("completionCommentBody — honest completion state (BAN-799)", () => {
  test("genuinely done (no PR / recovery off) → 'completed work'", () => {
    const { type, body } = build({ trigger: "fresh", reachedDone: true });
    expect(type).toBe("completed");
    expect(body).toContain("completed work");
  });

  test("resume that reaches done → 'completed work'", () => {
    const { type } = build({ trigger: "resume", reachedDone: true });
    expect(type).toBe("completed");
  });

  test("ci-fix exit → 'pushed a CI fix', NOT 'completed work'", () => {
    // ci-fix always rests in awaiting-ci; the trigger branch wins regardless
    // of reachedDone so a CI re-run can never announce completion.
    const { type, body } = build({ trigger: "ci-fix", reachedDone: false });
    expect(type).toBe("ci-fix-pushed");
    expect(body).toContain("pushed a CI fix");
    expect(body).not.toContain("completed work");
  });

  test("conflict-fix exit → 'resolved merge conflicts', NOT 'completed work'", () => {
    const { type, body } = build({ trigger: "conflict-fix", reachedDone: false });
    expect(type).toBe("conflicts-resolved");
    expect(body).not.toContain("completed work");
  });

  test("fresh run that opened a PR (deferred → awaiting-ci) → 'awaiting-ci', NOT 'completed work'", () => {
    const { type, body } = build({ trigger: "fresh", reachedDone: false });
    expect(type).toBe("awaiting-ci");
    expect(body).toContain("opened a PR");
    expect(body).toContain("Awaiting CI");
    expect(body).not.toContain("completed work");
  });

  test("review pass on an open PR (deferred → awaiting-ci) → 'awaiting-ci' with review wording", () => {
    const { type, body } = build({ trigger: "review", reachedDone: false });
    expect(type).toBe("awaiting-ci");
    expect(body).toContain("addressed review feedback");
    expect(body).not.toContain("completed work");
  });

  test("review pass that reaches done (no PR) → 'completed work'", () => {
    const { type } = build({ trigger: "review", reachedDone: true });
    expect(type).toBe("completed");
  });

  test("no code changes → 'completed-noop' regardless of reachedDone", () => {
    const { type } = build({ trigger: "fresh", reachedDone: true, noChanges: true });
    expect(type).toBe("completed-noop");
  });

  test("non-zero exit → 'exited' (quarantined), never a completion claim", () => {
    const { type, body } = build({ trigger: "fresh", reachedDone: false, ok: false, code: 1 });
    expect(type).toBe("exited");
    expect(body).not.toContain("completed work");
  });
});
