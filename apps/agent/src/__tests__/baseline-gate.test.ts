import { describe, expect, test } from "bun:test";
import { runBaselineGate, type BaselineGateLinear } from "../agent/baseline/gate";
import { AgentCoordinator, type CoordinatorDeps } from "../agent/coordinator";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";

const noopGit: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

function makeCmdRunner(map: Record<string, { code?: number; stderr?: string }>): CmdRunner {
  return {
    run: async (cmd) => {
      const key = cmd.join(" ");
      const entry = map[key];
      if (!entry || (entry.code ?? 0) === 0) return { stdout: "", stderr: entry?.stderr ?? "" };
      const err = new Error("fail") as Error & { code?: number; stderr?: string };
      err.code = entry.code ?? 1;
      err.stderr = entry.stderr ?? "";
      throw err;
    },
  };
}

function makeCoordinator(): AgentCoordinator {
  const deps: CoordinatorDeps = {
    fetchTodo: async () => [],
    fetchInProgress: async () => [],
    fetchConflicted: async () => [],
    fetchReview: async () => [],
    fetchMentions: async () => [],
    fetchDoneCandidates: async () => [],
    prepare: async () => ({ changeName: "x" }),
    spawnWorker: () => ({ exited: Promise.resolve(0), kill: () => {} }),
    applyIndicator: async () => {},
    removeIndicator: async () => {},
    postComment: async () => {},
    fetchComments: async () => [],
    checkPrStatus: async () => null,
    onLog: () => {},
    onWorkersChanged: () => {},
  };
  return new AgentCoordinator(deps, { concurrency: 1 });
}

function makeLinear(initial?: {
  existing?: { id: string; identifier: string; description: string | null } | null;
}): BaselineGateLinear & {
  created: { title: string; description: string }[];
  updated: { id: string; description: string }[];
  current: { id: string; identifier: string; description: string | null } | null;
} {
  const created: { title: string; description: string }[] = [];
  const updated: { id: string; description: string }[] = [];
  let current = initial?.existing ?? null;
  return {
    created,
    updated,
    get current() {
      return current;
    },
    set current(v) {
      current = v;
    },
    findOpen: async () => current,
    create: async (title, description) => {
      created.push({ title, description });
      current = { id: "new-id", identifier: "RLF-NEW", description };
      return { id: "new-id", identifier: "RLF-NEW" };
    },
    updateDescription: async (id, description) => {
      updated.push({ id, description });
      if (current && current.id === id) current = { ...current, description };
    },
  };
}

describe("runBaselineGate", () => {
  test("disabled → no-op", async () => {
    const coord = makeCoordinator();
    await runBaselineGate({
      enabled: false,
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
      cwd: "/tmp",
      cmdRunner: makeCmdRunner({ "bun test": { code: 1 } }),
      gitRunner: noopGit,
      coordinator: coord,
      onLog: () => {},
    });
    expect(coord.isPaused()).toBe(false);
  });

  test("clean baseline → no ticket created and pause cleared", async () => {
    const coord = makeCoordinator();
    coord.setPaused({
      issueIdentifier: "RLF-99",
      command: "x",
      fingerprint: "old",
      since: Date.now(),
    });
    const lin = makeLinear();
    await runBaselineGate({
      enabled: true,
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
      cwd: "/tmp",
      cmdRunner: makeCmdRunner({ "bun test": { code: 0 } }),
      gitRunner: noopGit,
      coordinator: coord,
      linear: lin,
      onLog: () => {},
    });
    expect(coord.isPaused()).toBe(false);
    expect(lin.created).toHaveLength(0);
  });

  test("broken baseline → ticket created and pause set", async () => {
    const coord = makeCoordinator();
    const lin = makeLinear();
    await runBaselineGate({
      enabled: true,
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
      cwd: "/tmp",
      cmdRunner: makeCmdRunner({ "bun test": { code: 1, stderr: "ReferenceError: x" } }),
      gitRunner: noopGit,
      coordinator: coord,
      linear: lin,
      onLog: () => {},
    });
    expect(coord.isPaused()).toBe(true);
    expect(coord.getPause()?.issueIdentifier).toBe("RLF-NEW");
    expect(lin.created).toHaveLength(1);
    expect(lin.created[0]!.description).toContain("ralphy:baseline:");
  });

  test("unchanged fingerprint → no duplicate update", async () => {
    const coord = makeCoordinator();
    // First run creates the ticket.
    const lin = makeLinear();
    const run = async () =>
      runBaselineGate({
        enabled: true,
        commands: ["bun test"],
        baseBranch: "main",
        outputCharLimit: 4000,
        cwd: "/tmp",
        cmdRunner: makeCmdRunner({ "bun test": { code: 1, stderr: "boom" } }),
        gitRunner: noopGit,
        coordinator: coord,
        linear: lin,
        onLog: () => {},
      });

    await run();
    expect(lin.created).toHaveLength(1);
    await run();
    // Same fingerprint → no description update on the second poll.
    expect(lin.updated).toHaveLength(0);
  });

  test("changed fingerprint → existing ticket description updated", async () => {
    const coord = makeCoordinator();
    const lin = makeLinear({
      existing: {
        id: "i-1",
        identifier: "RLF-1",
        description: "<!-- ralphy:baseline:oldFingerprint -->\n",
      },
    });
    await runBaselineGate({
      enabled: true,
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
      cwd: "/tmp",
      cmdRunner: makeCmdRunner({ "bun test": { code: 1, stderr: "different" } }),
      gitRunner: noopGit,
      coordinator: coord,
      linear: lin,
      onLog: () => {},
    });
    expect(lin.updated).toHaveLength(1);
    expect(lin.updated[0]!.id).toBe("i-1");
    expect(coord.isPaused()).toBe(true);
  });

  test("baseline recovers → pause cleared", async () => {
    const coord = makeCoordinator();
    coord.setPaused({
      issueIdentifier: "RLF-1",
      command: "x",
      fingerprint: "abc",
      since: Date.now(),
    });
    const lin = makeLinear();
    await runBaselineGate({
      enabled: true,
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
      cwd: "/tmp",
      cmdRunner: makeCmdRunner({ "bun test": { code: 0 } }),
      gitRunner: noopGit,
      coordinator: coord,
      linear: lin,
      onLog: () => {},
    });
    expect(coord.isPaused()).toBe(false);
  });

  test("Linear ticket closed by human while baseline still red → new ticket opened", async () => {
    const coord = makeCoordinator();
    // Human closed the prior ticket — findOpen returns null even though
    // baseline is still failing. A new ticket gets created.
    const lin = makeLinear({ existing: null });
    await runBaselineGate({
      enabled: true,
      commands: ["bun test"],
      baseBranch: "main",
      outputCharLimit: 4000,
      cwd: "/tmp",
      cmdRunner: makeCmdRunner({ "bun test": { code: 1, stderr: "still red" } }),
      gitRunner: noopGit,
      coordinator: coord,
      linear: lin,
      onLog: () => {},
    });
    expect(lin.created).toHaveLength(1);
    expect(coord.isPaused()).toBe(true);
  });
});
