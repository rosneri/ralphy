import { describe, test, expect } from "bun:test";
import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import {
  resolveScaffoldsDir,
  resolveTasksDir,
  resolvePhasesDir,
  resolveChecklistsDir,
} from "../content";

describe("content path resolvers", () => {
  test("resolveScaffoldsDir returns an absolute path ending in /scaffolds", () => {
    const dir = resolveScaffoldsDir();
    expect(dir).toMatch(/scaffolds$/);
    expect(isAbsolute(dir)).toBe(true);
  });

  test("resolveTasksDir returns an absolute path ending in /tasks", () => {
    const dir = resolveTasksDir();
    expect(dir).toMatch(/tasks$/);
    expect(isAbsolute(dir)).toBe(true);
    // tasks/ is the one directory that is tracked (via .gitkeep)
    expect(existsSync(dir)).toBe(true);
  });

  test("resolvePhasesDir returns an absolute path ending in /phases", () => {
    const dir = resolvePhasesDir();
    expect(dir).toMatch(/phases$/);
    expect(isAbsolute(dir)).toBe(true);
  });

  test("resolveChecklistsDir returns an absolute path ending in /checklists", () => {
    const dir = resolveChecklistsDir();
    expect(dir).toMatch(/checklists$/);
    expect(isAbsolute(dir)).toBe(true);
  });
});
