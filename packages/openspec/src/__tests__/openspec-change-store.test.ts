import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChangeStore } from "@ralphy/change-store";

type SpawnResult = { exitCode: number; stdout: string; stderr: string };

const spawnCalls: { cmd: string[] }[] = [];
let nextSpawnResult: SpawnResult = { exitCode: 0, stdout: "", stderr: "" };
const encoder = new TextEncoder();

// Patch Bun.spawnSync so the store's shell-outs are observable in tests.
Object.assign(Bun, {
  spawnSync: (options: { cmd: string[] }) => {
    spawnCalls.push({ cmd: options.cmd });
    return {
      exitCode: nextSpawnResult.exitCode,
      success: nextSpawnResult.exitCode === 0,
      stdout: encoder.encode(nextSpawnResult.stdout),
      stderr: encoder.encode(nextSpawnResult.stderr),
      pid: 0,
      signalCode: null,
      resourceUsage: undefined,
    };
  },
});

const { OpenSpecChangeStore, appendSteeringTaskToTasksMd } =
  await import("../openspec-change-store");

let tempDir: string;
let originalCwd: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "openspec-store-test-"));
  originalCwd = process.cwd();
  process.chdir(tempDir);
  mkdirSync(join(tempDir, "openspec", "changes", "sample-change"), { recursive: true });
  spawnCalls.length = 0;
  nextSpawnResult = { exitCode: 0, stdout: "", stderr: "" };
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("OpenSpecChangeStore", () => {
  test("satisfies the ChangeStore interface", () => {
    const store: ChangeStore = new OpenSpecChangeStore();
    expect(typeof store.createChange).toBe("function");
    expect(typeof store.archiveChange).toBe("function");
    expect(typeof store.validateChange).toBe("function");
    expect(typeof store.getChangeDirectory).toBe("function");
    expect(typeof store.readTaskList).toBe("function");
    expect(typeof store.writeTaskList).toBe("function");
    expect(typeof store.appendSteering).toBe("function");
    expect(typeof store.listChanges).toBe("function");
    expect(typeof store.getStatus).toBe("function");
    expect(typeof store.getInstructions).toBe("function");
    expect(typeof store.showChange).toBe("function");
  });

  test("getChangeDirectory returns the expected path", () => {
    const store = new OpenSpecChangeStore();
    expect(store.getChangeDirectory("sample-change")).toBe(
      join("openspec", "changes", "sample-change"),
    );
  });

  test("readTaskList reads tasks.md from the change directory", async () => {
    const store = new OpenSpecChangeStore();
    const tasksPath = join(tempDir, "openspec", "changes", "sample-change", "tasks.md");
    writeFileSync(tasksPath, "## Work\n- [ ] item one\n", "utf-8");

    const content = await store.readTaskList("sample-change");
    expect(content).toContain("item one");
  });

  test("readTaskList returns empty string when tasks.md is missing", async () => {
    const store = new OpenSpecChangeStore();
    const content = await store.readTaskList("sample-change");
    expect(content).toBe("");
  });

  test("writeTaskList writes tasks.md to the change directory", async () => {
    const store = new OpenSpecChangeStore();
    await store.writeTaskList("sample-change", "## Work\n- [ ] new item\n");

    const tasksPath = join(tempDir, "openspec", "changes", "sample-change", "tasks.md");
    expect(existsSync(tasksPath)).toBe(true);
    expect(readFileSync(tasksPath, "utf-8")).toContain("new item");
  });

  test("appendSteering creates steering.md when missing", async () => {
    const store = new OpenSpecChangeStore();
    await store.appendSteering("sample-change", "Initial steering");

    const steeringPath = join(tempDir, "openspec", "changes", "sample-change", "steering.md");
    expect(existsSync(steeringPath)).toBe(true);
    const content = readFileSync(steeringPath, "utf-8");
    expect(content).toContain("Initial steering");
  });

  test("appendSteering also appends a task to tasks.md ## Steering section (creates section)", async () => {
    const store = new OpenSpecChangeStore();
    const tasksPath = join(tempDir, "openspec", "changes", "sample-change", "tasks.md");
    writeFileSync(tasksPath, "## Planning\n\n- [x] do thing\n", "utf-8");

    await store.appendSteering("sample-change", "Need to handle X\n\nMore detail here");

    const tasks = readFileSync(tasksPath, "utf-8");
    expect(tasks).toContain("## Steering");
    expect(tasks).toContain("- [ ] Address steering: Need to handle X");
    // Original Planning section is preserved.
    expect(tasks).toContain("## Planning");
    expect(tasks).toContain("- [x] do thing");
  });

  test("appendSteering appends new task under an existing ## Steering section", async () => {
    const store = new OpenSpecChangeStore();
    const tasksPath = join(tempDir, "openspec", "changes", "sample-change", "tasks.md");
    writeFileSync(
      tasksPath,
      "## Planning\n\n- [x] plan\n\n## Steering\n\n- [ ] Address steering: first\n",
      "utf-8",
    );

    await store.appendSteering("sample-change", "second nudge");

    const tasks = readFileSync(tasksPath, "utf-8");
    expect(tasks.match(/## Steering/g)?.length).toBe(1);
    const idxFirst = tasks.indexOf("first");
    const idxSecond = tasks.indexOf("second nudge");
    expect(idxFirst).toBeGreaterThan(-1);
    expect(idxSecond).toBeGreaterThan(idxFirst);
  });

  test("appendSteeringTaskToTasksMd handles empty input", () => {
    expect(appendSteeringTaskToTasksMd("", "- [ ] X")).toBe("## Steering\n\n- [ ] X\n");
  });

  test("appendSteering prepends to existing steering.md", async () => {
    const store = new OpenSpecChangeStore();
    const steeringPath = join(tempDir, "openspec", "changes", "sample-change", "steering.md");
    writeFileSync(steeringPath, "Original note\n", "utf-8");

    await store.appendSteering("sample-change", "Follow-up note");

    const updated = readFileSync(steeringPath, "utf-8");
    expect(updated).toContain("Original note");
    expect(updated).toContain("Follow-up note");
    expect(updated.indexOf("Follow-up note")).toBeLessThan(updated.indexOf("Original note"));
  });

  test("createChange invokes the openspec bin with Node", async () => {
    const store = new OpenSpecChangeStore();
    await store.createChange("my-change", "A new change");

    expect(spawnCalls.length).toBe(1);
    const cmd = spawnCalls[0]!.cmd;
    expect(cmd[0]).toBe(process.execPath);
    expect(cmd[1]).toMatch(/openspec\.js$/);
    expect(cmd).toContain("new");
    expect(cmd).toContain("change");
    expect(cmd).toContain("my-change");
  });

  test("createChange throws when spawn exits non-zero", async () => {
    nextSpawnResult = { exitCode: 1, stdout: "", stderr: "boom" };
    const store = new OpenSpecChangeStore();
    await expect(store.createChange("bad-change", "desc")).rejects.toThrow();
  });

  test("validateChange parses JSON output into a ValidationResult", async () => {
    nextSpawnResult = {
      exitCode: 0,
      stdout: JSON.stringify({ valid: true, warnings: ["minor"], errors: [] }),
      stderr: "",
    };
    const store = new OpenSpecChangeStore();
    const result = await store.validateChange("sample-change");

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(["minor"]);
    expect(result.errors).toEqual([]);
  });

  test("archiveChange invokes the openspec bin with Node and does not skip specs", async () => {
    const store = new OpenSpecChangeStore();
    await store.archiveChange("sample-change");

    expect(spawnCalls.length).toBe(1);
    const cmd = spawnCalls[0]!.cmd;
    expect(cmd[0]).toBe(process.execPath);
    expect(cmd[1]).toMatch(/openspec\.js$/);
    expect(cmd).toContain("archive");
    expect(cmd).toContain("sample-change");
    expect(cmd).not.toContain("--skip-specs");
  });

  test("getStatus parses JSON output into a ChangeStatus", async () => {
    nextSpawnResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        changeName: "sample-change",
        isComplete: false,
        applyRequires: ["tasks"],
        artifacts: [
          { id: "proposal", status: "ready", outputPath: "proposal.md" },
          { id: "tasks", status: "blocked", missingDeps: ["proposal"] },
        ],
      }),
      stderr: "",
    };
    const store = new OpenSpecChangeStore();
    const status = await store.getStatus("sample-change");

    expect(spawnCalls[0]!.cmd).toContain("status");
    expect(spawnCalls[0]!.cmd).toContain("--change");
    expect(spawnCalls[0]!.cmd).toContain("sample-change");
    expect(spawnCalls[0]!.cmd).toContain("--json");
    expect(status.isComplete).toBe(false);
    expect(status.applyRequires).toEqual(["tasks"]);
    expect(status.artifacts).toHaveLength(2);
  });

  test("getStatus returns a safe fallback when stdout is not JSON", async () => {
    nextSpawnResult = { exitCode: 0, stdout: "not-json", stderr: "" };
    const store = new OpenSpecChangeStore();
    const status = await store.getStatus("sample-change");
    expect(status.isComplete).toBe(false);
    expect(status.artifacts).toEqual([]);
  });

  test("getInstructions parses JSON output into ArtifactInstructions", async () => {
    nextSpawnResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        changeName: "sample-change",
        artifactId: "tasks",
        instruction: "Create the task list…",
        template: "## 1. Group\n\n- [ ] 1.1 task\n",
        dependencies: [{ id: "specs", done: false, path: "specs/**/*.md" }],
      }),
      stderr: "",
    };
    const store = new OpenSpecChangeStore();
    const instr = await store.getInstructions("sample-change", "tasks");

    expect(spawnCalls[0]!.cmd).toContain("instructions");
    expect(spawnCalls[0]!.cmd).toContain("tasks");
    expect(spawnCalls[0]!.cmd).toContain("--change");
    expect(spawnCalls[0]!.cmd).toContain("sample-change");
    expect(spawnCalls[0]!.cmd).toContain("--json");
    expect(instr.instruction).toContain("Create the task list");
    expect(instr.template).toContain("1.1 task");
    expect(instr.dependencies?.[0]?.id).toBe("specs");
  });

  test("showChange parses JSON output into ChangeDeltas", async () => {
    nextSpawnResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        id: "sample-change",
        title: "Sample",
        deltaCount: 2,
        deltas: [{}, {}],
      }),
      stderr: "",
    };
    const store = new OpenSpecChangeStore();
    const result = await store.showChange("sample-change");

    expect(spawnCalls[0]!.cmd).toContain("show");
    expect(spawnCalls[0]!.cmd).toContain("sample-change");
    expect(spawnCalls[0]!.cmd).toContain("--json");
    expect(spawnCalls[0]!.cmd).toContain("--type");
    expect(spawnCalls[0]!.cmd).toContain("change");
    expect(result.deltaCount).toBe(2);
    expect(result.title).toBe("Sample");
  });

  test("archiveChange throws when spawn exits non-zero", async () => {
    nextSpawnResult = { exitCode: 2, stdout: "", stderr: "error" };
    const store = new OpenSpecChangeStore();
    await expect(store.archiveChange("sample-change")).rejects.toThrow();
  });

  test("archiveChange error message names the change and exit status", async () => {
    nextSpawnResult = { exitCode: 7, stdout: "", stderr: "boom" };
    const store = new OpenSpecChangeStore();
    await expect(store.archiveChange("sample-change")).rejects.toThrow(
      'openspec archive failed for "sample-change" (exit 7)',
    );
  });
});
