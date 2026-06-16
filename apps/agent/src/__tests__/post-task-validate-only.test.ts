import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runValidateOnlyPhase } from "../agent/post-task";
import { AGENT_TASKS_FILENAME } from "@ralphy/core/tasks-md";

let tmpDir: string;
let changeDir: string;
let stateFilePath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "validate-only-test-"));
  changeDir = join(tmpDir, "changes", "my-change");
  await mkdir(changeDir, { recursive: true });

  stateFilePath = join(tmpDir, ".ralph-state.json");
  await Bun.write(
    stateFilePath,
    JSON.stringify({ status: "completed", lastModified: new Date().toISOString() }, null, 2),
  );
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeInput(validateCommands: string[] = []) {
  return {
    changeName: "my-change",
    changeDir,
    stateFilePath,
    validateCommands,
    cwd: tmpDir,
  };
}

describe("runValidateOnlyPhase", () => {
  test("no commands → straight to validation task injected", async () => {
    let respawned = false;
    const phases: string[] = [];

    await runValidateOnlyPhase(makeInput([]), {
      log: () => {},
      emit: (phase) => phases.push(phase),
      respawnWorker: async () => {
        respawned = true;
        return 0;
      },
    });

    expect(phases).toContain("validate");
    expect(respawned).toBe(true);

    const agentTasksContent = await Bun.file(join(changeDir, AGENT_TASKS_FILENAME)).text();
    expect(agentTasksContent).toContain("Run openspec validation");
    expect(agentTasksContent).toContain("bunx openspec validate my-change");
    expect(agentTasksContent).toContain("- [ ]");
  });

  test("checks pass → validation task injected", async () => {
    let respawned = false;
    const phases: string[] = [];

    await runValidateOnlyPhase(makeInput(["bun run test", "bun run lint"]), {
      log: () => {},
      emit: (phase) => phases.push(phase),
      respawnWorker: async () => {
        respawned = true;
        return 0;
      },
      runCommand: async () => ({ exitCode: 0, output: "ok" }),
    });

    expect(phases).toContain("validate");
    expect(phases).not.toContain("validate-fix");
    expect(respawned).toBe(true);

    const agentTasksContent = await Bun.file(join(changeDir, AGENT_TASKS_FILENAME)).text();
    expect(agentTasksContent).toContain("Run openspec validation");
    expect(agentTasksContent).toContain("bunx openspec validate my-change");
  });

  test("first check fails → fix task injected", async () => {
    let respawned = false;
    const phases: string[] = [];
    const loggedMessages: string[] = [];
    let runCount = 0;

    await runValidateOnlyPhase(makeInput(["bun run test", "bun run lint"]), {
      log: (msg) => loggedMessages.push(msg),
      emit: (phase) => phases.push(phase),
      respawnWorker: async () => {
        respawned = true;
        return 0;
      },
      runCommand: async (cmd) => {
        runCount++;
        if (cmd === "bun run test") return { exitCode: 1, output: "error: tests failed" };
        return { exitCode: 0, output: "ok" };
      },
    });

    expect(phases).toContain("validate");
    expect(phases).toContain("validate-fix");
    expect(respawned).toBe(true);
    // Only the first (failing) command should have been run
    expect(runCount).toBe(1);

    const agentTasksContent = await Bun.file(join(changeDir, AGENT_TASKS_FILENAME)).text();
    expect(agentTasksContent).toContain("Fix failing validation");
    expect(agentTasksContent).toContain("bun run test");
    expect(agentTasksContent).toContain("error: tests failed");
    // No openspec validation task since we failed
    expect(agentTasksContent).not.toContain("Run openspec validation");
  });

  test("failing structure check → fix task prepended and worker respawned", async () => {
    // The in-loop structural gate (`bun run check:structure`) rides in
    // validateCommands; its non-zero exit must prepend a fix task and respawn
    // just like the test/lint gates.
    let respawned = false;
    const phases: string[] = [];

    await runValidateOnlyPhase(makeInput(["bun test", "bun run check:structure"]), {
      log: () => {},
      emit: (phase, detail) => phases.push(detail ? `${phase}:${detail}` : phase),
      respawnWorker: async () => {
        respawned = true;
        return 0;
      },
      runCommand: async (cmd) => {
        if (cmd === "bun run check:structure")
          return { exitCode: 1, output: "check-folder-size: packages/core too large" };
        return { exitCode: 0, output: "ok" };
      },
    });

    expect(phases).toContain("validate-fix:bun run check:structure");
    expect(respawned).toBe(true);

    const agentTasksContent = await Bun.file(join(changeDir, AGENT_TASKS_FILENAME)).text();
    expect(agentTasksContent).toContain("Fix failing validation: bun run check:structure");
    expect(agentTasksContent).toContain("check-folder-size: packages/core too large");
    expect(agentTasksContent).not.toContain("Run openspec validation");
  });

  test("state is reactivated before respawnWorker is called", async () => {
    let stateAtRespawn: { status?: string } | null = null;

    await runValidateOnlyPhase(makeInput([]), {
      log: () => {},
      emit: () => {},
      respawnWorker: async () => {
        const text = await Bun.file(stateFilePath).text();
        stateAtRespawn = JSON.parse(text) as { status?: string };
        return 0;
      },
    });

    expect(stateAtRespawn).not.toBeNull();
    expect(stateAtRespawn!.status).toBe("active");
  });
});
