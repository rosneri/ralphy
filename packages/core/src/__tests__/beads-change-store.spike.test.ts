/**
 * THROWAWAY SPIKE TEST — RLF-213.
 *
 * Proves the prototype `BeadsChangeStore` read-path reproduces the markdown
 * task-selection rules: the task it picks from a fixture `bd` state matches
 * what `firstUnchecked` selects from the equivalent `tasks.md`, including the
 * flow-preempts-mission invariant, and that a blocked-but-not-done change is
 * never reported complete from an empty `bd ready`.
 *
 * `Bun.spawnSync` is patched (the same pattern as the OpenSpec store test) so
 * `bd` is never actually invoked; the fixture JSON stands in for `bd` output.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { firstUnchecked } from "../tasks-md";

// --- bd-output fixtures -----------------------------------------------------

interface BdRecord {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  parent?: string;
  dependencies?: { issue_id: string; depends_on_id: string; type: string }[];
}

const EPIC: BdRecord = {
  id: "ch-epic",
  title: "Change: demo",
  status: "open",
  priority: 2,
  issue_type: "epic",
};

const mkTask = (id: string, title: string, priority = 2): BdRecord => ({
  id,
  title,
  status: "open",
  priority,
  issue_type: "task",
  parent: EPIC.id,
});

// --- command-aware Bun.spawnSync patch --------------------------------------

const encoder = new TextEncoder();
let listAll: BdRecord[] = []; // answers `bd list --status open --json` (epic discovery)
let openChildren: BdRecord[] = []; // answers `bd list … --parent <epic> …`
let ready: BdRecord[] = []; // answers `bd ready … --parent <epic> …`
const spawnCalls: string[][] = [];

function jsonResult(value: unknown) {
  return {
    exitCode: 0,
    success: true,
    stdout: encoder.encode(JSON.stringify(value)),
    stderr: encoder.encode(""),
    pid: 0,
    signalCode: null,
    resourceUsage: undefined,
  };
}

Object.assign(Bun, {
  spawnSync: (options: { cmd: string[] }) => {
    const cmd = options.cmd;
    spawnCalls.push(cmd);
    if (cmd.includes("ready")) return jsonResult(ready);
    if (cmd.includes("--parent")) return jsonResult(openChildren);
    return jsonResult(listAll); // `bd list --status open --json`
  },
});

const { BeadsChangeStore } = await import("./beads-change-store.spike");

/** First `- [ ]` task title in the section `firstUnchecked` would pick. */
function firstUncheckedTitle(markdown: string): string | null {
  const section = firstUnchecked(markdown);
  if (!section) return null;
  const match = section.match(/^- \[ \] (.+?)(?: <!--.*-->)?$/m);
  return match ? match[1]!.trim() : null;
}

beforeEach(() => {
  listAll = [];
  openChildren = [];
  ready = [];
  spawnCalls.length = 0;
});

describe("BeadsChangeStore spike — read-path parity", () => {
  // Scenario: ready selection matches firstUnchecked
  test("picks the same next task as firstUnchecked over the equivalent tasks.md", async () => {
    // Epic with three open children A,B,C; B is blocked by A.
    const a = mkTask("ch-a", "Task A");
    const b = mkTask("ch-b", "Task B");
    const c = mkTask("ch-c", "Task C");
    b.dependencies = [{ issue_id: b.id, depends_on_id: a.id, type: "blocks" }];

    listAll = [EPIC, a, b, c];
    // bd withholds B (blocked by open A); A sorts first.
    ready = [a, c];

    const store = new BeadsChangeStore();
    const rendered = await store.readTaskList("demo");
    const bdPick = firstUncheckedTitle(rendered);

    // The equivalent human-authored tasks.md: A precedes B (it must), then C.
    const equivalentTasksMd = [
      "## Mission tasks",
      "",
      "- [ ] Task A",
      "- [ ] Task B",
      "- [ ] Task C",
    ].join("\n");
    const mdPick = firstUncheckedTitle(equivalentTasksMd);

    expect(bdPick).toBe("Task A");
    expect(bdPick).toBe(mdPick);
  });

  // Scenario: a high-priority flow bead that blocks mission work is selected first
  test("flow bead (p0) preempts mission work, like agent-tasks.md over tasks.md", async () => {
    const flow = mkTask("ch-flow", "FLOW: fix CI", 0);
    const a = mkTask("ch-a", "Task A");
    const c = mkTask("ch-c", "Task C");
    a.dependencies = [{ issue_id: a.id, depends_on_id: flow.id, type: "blocks" }];

    listAll = [EPIC, flow, a, c];
    // bd ready: flow (p0) first, A withheld (blocked by flow), then C.
    ready = [flow, c];

    const store = new BeadsChangeStore();
    const rendered = await store.readTaskList("demo");

    // Flow section must be emitted first so firstUnchecked selects it —
    // mirroring pickActiveTasksFile preferring agent-tasks.md.
    expect(rendered.indexOf("## Flow tasks")).toBeLessThan(rendered.indexOf("## Mission tasks"));
    expect(firstUncheckedTitle(rendered)).toBe("FLOW: fix CI");

    // Parity: the equivalent agent-tasks.md (flow) + tasks.md (mission) where
    // pickActiveTasksFile prefers the flow file → "FLOW: fix CI".
    const agentTasksMd = "## Flow tasks\n\n- [ ] FLOW: fix CI";
    expect(firstUncheckedTitle(agentTasksMd)).toBe("FLOW: fix CI");
  });

  // Scenario: blocked-but-not-done is not reported complete
  test("getStatus reports NOT complete when an open child is blocked and ready is empty", async () => {
    const blocked = mkTask("ch-b", "Task B");
    blocked.dependencies = [{ issue_id: blocked.id, depends_on_id: "ext-x", type: "blocks" }];

    listAll = [EPIC, blocked];
    openChildren = [blocked]; // one open child remains…
    ready = []; // …but nothing is ready (it's blocked)

    const store = new BeadsChangeStore();
    const status = await store.getStatus("demo");

    expect(status.isComplete).toBe(false); // empty `ready` is NOT "done"
    expect(status.artifacts).toHaveLength(1);
    expect(status.artifacts[0]!.status).toBe("blocked");
    expect(status.artifacts[0]!.missingDeps).toEqual(["ext-x"]);
  });

  test("getStatus reports complete only when the epic has no open children", async () => {
    listAll = [EPIC];
    openChildren = [];
    ready = [];

    const store = new BeadsChangeStore();
    const status = await store.getStatus("demo");
    expect(status.isComplete).toBe(true);
  });

  test("readTaskList returns empty string when no matching epic exists", async () => {
    listAll = []; // no epic titled "Change: demo"
    const store = new BeadsChangeStore();
    expect(await store.readTaskList("demo")).toBe("");
  });

  test("validateChange fails when the change has no bd epic", async () => {
    listAll = [];
    const store = new BeadsChangeStore();
    const result = await store.validateChange("demo");
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("no bd epic");
  });

  test("validateChange passes when the change epic exists", async () => {
    listAll = [EPIC];
    const store = new BeadsChangeStore();
    const result = await store.validateChange("demo");
    expect(result.valid).toBe(true);
  });

  test("write-path methods throw (out of spike scope)", async () => {
    const store = new BeadsChangeStore();
    // The spike implements the write-path methods as zero-arg stubs that
    // reject; the read-path is the only prototyped surface.
    await expect(store.writeTaskList()).rejects.toThrow("not implemented");
    await expect(store.createChange()).rejects.toThrow("not implemented");
  });
});
