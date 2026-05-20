import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  readState,
  writeState,
  updateState,
  buildInitialState,
  ensureState,
  tryReadStateRaw,
} from "../state";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

let tempDir: string;
const withStorage = <T>(fn: () => T): T => runWithContext(createDefaultContext(), fn);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "state-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("readState / writeState", () => {
  test("round-trips a valid state object", () =>
    withStorage(() => {
      const state = buildInitialState({ name: "test", prompt: "do things" });
      writeState(tempDir, state);
      const read = readState(tempDir);
      expect(read.name).toBe("test");
      expect(read.prompt).toBe("do things");
      expect(read.version).toBe("2");
    }));

  test("throws when .ralph-state.json is missing", () =>
    withStorage(() => {
      expect(() => readState(tempDir)).toThrow();
    }));

  test("throws when .ralph-state.json contains invalid JSON", () =>
    withStorage(() => {
      writeFileSync(join(tempDir, ".ralph-state.json"), "not json", "utf-8");
      expect(() => readState(tempDir)).toThrow();
    }));

  test("written file is valid JSON with trailing newline", () =>
    withStorage(() => {
      const state = buildInitialState({ name: "test", prompt: "p" });
      writeState(tempDir, state);
      const raw = readFileSync(join(tempDir, ".ralph-state.json"), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(raw)).not.toThrow();
    }));
});

describe("tryReadStateRaw", () => {
  test("returns null state and raw when file is missing", () =>
    withStorage(() => {
      expect(tryReadStateRaw(tempDir)).toEqual({ state: null, raw: null });
    }));

  test("returns null state and raw when JSON is malformed", () =>
    withStorage(() => {
      writeFileSync(join(tempDir, ".ralph-state.json"), "not json", "utf-8");
      expect(tryReadStateRaw(tempDir)).toEqual({ state: null, raw: null });
    }));

  test("returns parsed state and raw when file is a valid state", () =>
    withStorage(() => {
      const state = buildInitialState({ name: "valid", prompt: "p" });
      writeState(tempDir, state);
      const result = tryReadStateRaw(tempDir);
      expect(result.state?.name).toBe("valid");
      expect(result.raw).not.toBeNull();
      expect((result.raw as { name?: string }).name).toBe("valid");
    }));

  test("returns null state but raw object when schema validation fails", () =>
    withStorage(() => {
      writeFileSync(
        join(tempDir, ".ralph-state.json"),
        JSON.stringify({ unexpected: "shape", linearComments: ["c"] }),
        "utf-8",
      );
      const result = tryReadStateRaw(tempDir);
      expect(result.state).toBeNull();
      expect(result.raw).toEqual({ unexpected: "shape", linearComments: ["c"] });
    }));

  test("treats non-object JSON (e.g. a bare string) as empty raw", () =>
    withStorage(() => {
      writeFileSync(join(tempDir, ".ralph-state.json"), JSON.stringify("plain string"), "utf-8");
      const result = tryReadStateRaw(tempDir);
      expect(result.state).toBeNull();
      expect(result.raw).toEqual({});
    }));
});

describe("updateState", () => {
  test("applies updater function and persists", () =>
    withStorage(() => {
      const state = buildInitialState({ name: "test", prompt: "p" });
      writeState(tempDir, state);

      const updated = updateState(tempDir, (snapshot) => ({
        ...snapshot,
        status: "blocked" as const,
      }));

      expect(updated.status).toBe("blocked");

      // Verify persisted
      const reread = readState(tempDir);
      expect(reread.status).toBe("blocked");
    }));
});

describe("buildInitialState", () => {
  test("creates state with required fields", () => {
    const state = buildInitialState({ name: "my-task", prompt: "convert to ts" });
    expect(state.name).toBe("my-task");
    expect(state.prompt).toBe("convert to ts");
    expect(state.engine).toBe("claude");
    expect(state.model).toBe("opus");
    expect(state.status).toBe("active");
    expect(state.history).toEqual([]);
    expect(state.usage.total_cost_usd).toBe(0);
  });

  test("respects custom engine and model", () => {
    const state = buildInitialState({
      name: "t",
      prompt: "p",
      engine: "codex",
      model: "sonnet",
    });
    expect(state.engine).toBe("codex");
    expect(state.model).toBe("sonnet");
  });

  test("sets createdAt and lastModified to ISO timestamps", () => {
    const state = buildInitialState({ name: "t", prompt: "p" });
    expect(() => new Date(state.createdAt)).not.toThrow();
    expect(() => new Date(state.lastModified)).not.toThrow();
  });
});

describe("ensureState", () => {
  test("returns existing state when .ralph-state.json exists", () =>
    withStorage(() => {
      const original = buildInitialState({ name: "existing", prompt: "p" });
      writeState(tempDir, original);
      const state = ensureState(tempDir);
      expect(state.name).toBe("existing");
    }));

  test("initialises fresh state when no .ralph-state.json exists", () =>
    withStorage(() => {
      const state = ensureState(tempDir);
      expect(state.status).toBe("active");
      expect(existsSync(join(tempDir, ".ralph-state.json"))).toBe(true);
    }));
});
