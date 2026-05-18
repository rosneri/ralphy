import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import type { ChangeStore } from "@ralphy/change-store";

mock.module("@ralphy/core/git", () => ({
  commitState: mock(() => {}),
}));

// Patch Bun.spawn so the tools.ts shell-out is observable in tests.
const spawnMock = mock((_options: { cmd: string[] }) => ({
  unref: () => {},
  pid: 12345,
}));
Object.assign(Bun, { spawn: spawnMock });

const { registerTools } = await import("../tools");
const { buildInitialState } = await import("@ralphy/core/state");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-tools-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

class StubChangeStore implements ChangeStore {
  listChangesResult: string[] = [];
  appendedSteering: { name: string; message: string }[] = [];
  shouldThrowOnAppend = false;

  createChange(_name: string, _description: string): Promise<void> {
    return Promise.resolve();
  }
  getChangeDirectory(name: string): string {
    return join("openspec", "changes", name);
  }
  listChanges(): Promise<string[]> {
    return Promise.resolve(this.listChangesResult);
  }
  readTaskList(_name: string): Promise<string> {
    return Promise.resolve("");
  }
  writeTaskList(_name: string, _content: string): Promise<void> {
    return Promise.resolve();
  }
  appendSteering(name: string, message: string): Promise<void> {
    if (this.shouldThrowOnAppend) {
      return Promise.reject(new Error("append failed"));
    }
    this.appendedSteering.push({ name, message });
    return Promise.resolve();
  }
  validateChange(_name: string): Promise<{ valid: boolean; warnings: string[]; errors: string[] }> {
    return Promise.resolve({ valid: true, warnings: [], errors: [] });
  }
  getStatus(name: string) {
    return Promise.resolve({
      changeName: name,
      isComplete: true,
      applyRequires: [],
      artifacts: [],
    });
  }
  getInstructions(name: string, artifact: string) {
    return Promise.resolve({ changeName: name, artifactId: artifact, instruction: "" });
  }
  showChange(name: string) {
    return Promise.resolve({ id: name, deltaCount: 0, deltas: [] });
  }
  archiveChange(_name: string): Promise<void> {
    return Promise.resolve();
  }
}

function captureHandlers(
  changesDir: string,
  store: ChangeStore = new StubChangeStore(),
): (name: string) => ToolHandler {
  const handlers = new Map<string, ToolHandler>();
  const mockServer = {
    registerTool: (name: string, _opts: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  };
  registerTools(mockServer, changesDir, store);
  return (name: string) => {
    const h = handlers.get(name);
    if (!h) throw new Error("No handler registered");
    return h;
  };
}

function createChange(
  changesDir: string,
  name: string,
  overrides: Record<string, unknown> = {},
): string {
  const changeDir = join(changesDir, name);
  mkdirSync(changeDir, { recursive: true });
  const state = buildInitialState({ name, prompt: `Test change ${name}` });
  const merged = { ...state, ...overrides };
  writeFileSync(join(changeDir, ".ralph-state.json"), JSON.stringify(merged, null, 2) + "\n");
  return changeDir;
}

function parseResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe("registerTools", () => {
  test("registers all 5 tools with correct names", () => {
    const registeredTools: string[] = [];
    const mockServer = {
      registerTool: mock((name: string) => {
        registeredTools.push(name);
      }),
    };

    registerTools(mockServer, tempDir, new StubChangeStore());

    expect(registeredTools).toEqual([
      "ralph_list_changes",
      "ralph_get_change",
      "ralph_create_change",
      "ralph_append_steering",
      "ralph_stop",
    ]);
  });
});

describe("ralph_list_changes", () => {
  test("returns empty list when no changes", async () => {
    const store = new StubChangeStore();
    const handler = captureHandlers(tempDir, store)("ralph_list_changes");
    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { changes: unknown[] };
    expect(data.changes).toEqual([]);
  });

  test("lists existing changes with state", async () => {
    createChange(tempDir, "change-one");
    const store = new StubChangeStore();
    store.listChangesResult = ["change-one"];
    const handler = captureHandlers(tempDir, store)("ralph_list_changes");
    const result = await handler({});
    const data = parseResult(result) as {
      changes: { name: string; status: string }[];
    };
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0]!.name).toBe("change-one");
    expect(data.changes[0]!.status).toBe("active");
  });

  test("excludes completed changes by default", async () => {
    createChange(tempDir, "done-change", { status: "completed" });
    const store = new StubChangeStore();
    store.listChangesResult = ["done-change"];
    const handler = captureHandlers(tempDir, store)("ralph_list_changes");
    const result = await handler({});
    const data = parseResult(result) as { changes: unknown[] };
    expect(data.changes).toEqual([]);
  });

  test("includes completed changes when includeCompleted is true", async () => {
    createChange(tempDir, "done-change", { status: "completed" });
    const store = new StubChangeStore();
    store.listChangesResult = ["done-change"];
    const handler = captureHandlers(tempDir, store)("ralph_list_changes");
    const result = await handler({ includeCompleted: true });
    const data = parseResult(result) as { changes: { name: string }[] };
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0]!.name).toBe("done-change");
  });

  test("falls back to unknown status when state cannot be parsed", async () => {
    const changeDir = join(tempDir, "broken-change");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, ".ralph-state.json"), "{not-json");
    const store = new StubChangeStore();
    store.listChangesResult = ["broken-change"];
    const handler = captureHandlers(tempDir, store)("ralph_list_changes");
    const result = await handler({});
    const data = parseResult(result) as { changes: { name: string; status: string }[] };
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0]!.status).toBe("unknown");
  });

  test("returns error result when listChanges throws", async () => {
    const store = new StubChangeStore();
    store.listChanges = () => Promise.reject(new Error("listing failed"));
    const handler = captureHandlers(tempDir, store)("ralph_list_changes");
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error listing changes");
  });
});

describe("ralph_get_change", () => {
  test("returns change details", async () => {
    const changeDir = createChange(tempDir, "get-change");
    writeFileSync(join(changeDir, "tasks.md"), "- [ ] do it\n");
    writeFileSync(join(changeDir, "proposal.md"), "# Proposal\n");
    const handler = captureHandlers(tempDir)("ralph_get_change");
    const result = await handler({ name: "get-change" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as {
      name: string;
      hasTasks: boolean;
      hasProposal: boolean;
    };
    expect(data.name).toBe("get-change");
    expect(data.hasTasks).toBe(true);
    expect(data.hasProposal).toBe(true);
  });

  test("returns error when change does not exist", async () => {
    const handler = captureHandlers(tempDir)("ralph_get_change");
    const result = await handler({ name: "missing" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error getting change 'missing'");
  });
});

describe("ralph_create_change", () => {
  test("creates a new change with initial state", async () => {
    const handler = captureHandlers(tempDir)("ralph_create_change");
    const result = await handler({
      name: "new-change",
      prompt: "Do something",
    });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { created: string; changeDir: string };
    expect(data.created).toBe("new-change");
    expect(existsSync(join(tempDir, "new-change", ".ralph-state.json"))).toBe(true);
  });

  test("does not overwrite existing state when change already exists", async () => {
    const changeDir = createChange(tempDir, "existing-change", { iteration: 7 });
    const handler = captureHandlers(tempDir)("ralph_create_change");
    await handler({ name: "existing-change", prompt: "New prompt" });
    const stateRaw = readFileSync(join(changeDir, ".ralph-state.json"), "utf-8");
    const state = JSON.parse(stateRaw) as { iteration: number };
    expect(state.iteration).toBe(7);
  });

  test("starts a background run when run=true", async () => {
    spawnMock.mockClear();
    const handler = captureHandlers(tempDir)("ralph_create_change");
    const result = await handler({
      name: "run-change",
      prompt: "Do something",
      run: true,
      maxIterations: 3,
    });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { started: boolean; pid: number };
    expect(data.started).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test("forwards all CLI flags when starting a background run", async () => {
    spawnMock.mockClear();
    const handler = captureHandlers(tempDir)("ralph_create_change");
    await handler({
      name: "full-run",
      prompt: "Do",
      run: true,
      maxIterations: 2,
      maxCostUsd: 1,
      maxRuntimeMinutes: 5,
      engine: "codex",
      model: "gpt-5",
    });
    const call = spawnMock.mock.calls[0]![0] as { cmd: string[] };
    expect(call.cmd[0]).toBe("bun");
    expect(call.cmd).toContain("--max-iterations");
    expect(call.cmd).toContain("--max-cost");
    expect(call.cmd).toContain("--max-runtime");
    expect(call.cmd).toContain("--codex");
    expect(call.cmd).toContain("--model");
  });

  test("returns error when spawn throws", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });
    const handler = captureHandlers(tempDir)("ralph_create_change");
    const result = await handler({ name: "fail-run", prompt: "p", run: true });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error creating change");
  });
});

describe("ralph_append_steering", () => {
  test("appends steering when change exists", async () => {
    createChange(tempDir, "steer-change");
    const store = new StubChangeStore();
    const handler = captureHandlers(tempDir, store)("ralph_append_steering");
    const result = await handler({ name: "steer-change", message: "focus on tests" });
    expect(result.isError).toBeUndefined();
    expect(store.appendedSteering).toEqual([{ name: "steer-change", message: "focus on tests" }]);
  });

  test("returns error when change does not exist", async () => {
    const store = new StubChangeStore();
    const handler = captureHandlers(tempDir, store)("ralph_append_steering");
    const result = await handler({ name: "missing", message: "hi" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("does not exist");
    expect(store.appendedSteering).toEqual([]);
  });

  test("returns error when changeStore throws", async () => {
    createChange(tempDir, "throw-change");
    const store = new StubChangeStore();
    store.shouldThrowOnAppend = true;
    const handler = captureHandlers(tempDir, store)("ralph_append_steering");
    const result = await handler({ name: "throw-change", message: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error appending steering");
  });
});

describe("ralph_stop", () => {
  test("writes STOP file with default reason", async () => {
    const changeDir = createChange(tempDir, "stop-change");
    const handler = captureHandlers(tempDir)("ralph_stop");
    const result = await handler({ name: "stop-change" });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(changeDir, "STOP"), "utf-8")).toBe("Stopped via MCP");
  });

  test("writes STOP file with custom reason", async () => {
    const changeDir = createChange(tempDir, "stop-change");
    const handler = captureHandlers(tempDir)("ralph_stop");
    await handler({ name: "stop-change", reason: "manual halt" });
    expect(readFileSync(join(changeDir, "STOP"), "utf-8")).toBe("manual halt");
  });
});
