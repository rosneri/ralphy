import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPostTask } from "../agent/post-task";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";
import type { TrackedIssue } from "@ralphy/tracker";
import type { Bus, EmitInput } from "@ralphy/events";
import type { FeatureCtx } from "../features/types";
import { registry } from "../features/registry";
import { recordingBus } from "../__test-utils__/recording-bus";

const FAKE_ISSUE: TrackedIssue = {
  id: "issue-1",
  identifier: "COD-1",
  title: "Test issue",
  url: "https://linear.app/team/issue/COD-1",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

function makeCmd(): CmdRunner {
  return {
    run: async () => ({ stdout: "", stderr: "" }),
  };
}

function makeCtx(bus: Bus, issue: TrackedIssue): FeatureCtx {
  return {
    issue,
    worktree: "/tmp",
    state: { writeField: async () => {} },
    bus,
    caps: { gh: null, linear: null, git: null, fsChange: null, worker: null },
    poll: {} as FeatureCtx["poll"],
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  };
}

describe("runPostTask — feature registry walk", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-feature-registry-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseInput = (overrides: { exitCode?: number } = {}) => ({
    changeName: "my-change",
    cwd: tmpDir,
    projectRoot: tmpDir,
    changeDir,
    stateFilePath,
    branch: "ralph/my-change",
    issue: FAKE_ISSUE,
    exitCode: overrides.exitCode ?? 0,
    useWorktree: false,
    wantPr: false,
    wantAutoMerge: false,
    cfg: {
      teardownScript: null,
      prBaseBranch: "main",
      autoMergeStrategy: "squash" as const,
      cleanupWorktreeOnSuccess: false,
      stackPrsOnDependencies: false,
      neverTouch: [],
    },
    respawnWorker: async () => 0,
  });

  test("walk is skipped entirely when buildFeatureCtx is not wired", async () => {
    const events: EmitInput[] = [];
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

    await runPostTask(baseInput(), {
      cmd: makeCmd(),
      git,
      log: () => {},
      runScript: async () => {},
      onPhase: (phase) => events.push({ type: `phase.${phase}` } as EmitInput),
    });

    expect(events.some((e) => String(e.type).startsWith("feature."))).toBe(false);
  });

  test("features without postTask emit no events; postTask features fire when caps gate is open", async () => {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

    let ctxCalls = 0;
    await runPostTask(baseInput(), {
      cmd: makeCmd(),
      git,
      log: () => {},
      runScript: async () => {},
      buildFeatureCtx: (i) => {
        ctxCalls += 1;
        return makeCtx(bus, i);
      },
    });

    expect(ctxCalls).toBe(1);
    // conflict-fix, ci-fix and implement have real postTask hooks but
    // early-return when their respective caps slot isn't wired —
    // `runFeaturePostTask` still emits started+completed because the
    // postTask function exists. All other features here have no
    // postTask and emit nothing.
    const featureEvents = events
      .filter((e) => String(e.type).startsWith("feature."))
      .map((e) => String(e.type))
      .sort();
    expect(featureEvents).toEqual([
      "feature.ci-fix.completed",
      "feature.ci-fix.started",
      "feature.conflict-fix.completed",
      "feature.conflict-fix.started",
      "feature.implement.completed",
      "feature.implement.started",
    ]);
  });

  test("a feature with postTask receives the result and emits started/completed", async () => {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

    const seen: { exitCode: number; branch: string | null }[] = [];
    const target = registry[0]!;
    const original = target.postTask;
    (target as { postTask?: (typeof target)["postTask"] }).postTask = async (_ctx, result) => {
      seen.push({ exitCode: result.exitCode, branch: result.branch });
    };
    try {
      await runPostTask(baseInput({ exitCode: 7 }), {
        cmd: makeCmd(),
        git,
        log: () => {},
        runScript: async () => {},
        buildFeatureCtx: (i) => makeCtx(bus, i),
      });

      expect(seen).toEqual([{ exitCode: 7, branch: "ralph/my-change" }]);
      const types = events.map((e) => String(e.type));
      expect(types).toContain(`feature.${target.id}.started`);
      expect(types).toContain(`feature.${target.id}.completed`);
      expect(types.some((t) => t === `feature.${target.id}.failed`)).toBe(false);
    } finally {
      if (original) {
        (target as { postTask?: (typeof target)["postTask"] }).postTask = original;
      } else {
        delete (target as { postTask?: (typeof target)["postTask"] }).postTask;
      }
    }
  });

  test("a thrown postTask emits failed and does not block siblings", async () => {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

    const first = registry[0]!;
    const second = registry[1]!;
    let secondRan = false;
    const origFirst = first.postTask;
    const origSecond = second.postTask;
    (first as { postTask?: (typeof first)["postTask"] }).postTask = async () => {
      throw new Error("boom");
    };
    (second as { postTask?: (typeof second)["postTask"] }).postTask = async () => {
      secondRan = true;
    };
    try {
      await runPostTask(baseInput(), {
        cmd: makeCmd(),
        git,
        log: () => {},
        runScript: async () => {},
        buildFeatureCtx: (i) => makeCtx(bus, i),
      });

      expect(secondRan).toBe(true);
      const types = events.map((e) => String(e.type));
      expect(types).toContain(`feature.${first.id}.failed`);
      expect(types).toContain(`feature.${second.id}.completed`);
    } finally {
      if (origFirst) {
        (first as { postTask?: (typeof first)["postTask"] }).postTask = origFirst;
      } else {
        delete (first as { postTask?: (typeof first)["postTask"] }).postTask;
      }
      if (origSecond) {
        (second as { postTask?: (typeof second)["postTask"] }).postTask = origSecond;
      } else {
        delete (second as { postTask?: (typeof second)["postTask"] }).postTask;
      }
    }
  });
});
