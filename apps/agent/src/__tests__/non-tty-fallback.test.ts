import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const jsonRunnerCalls: unknown[] = [];
const inkRenderCalls: unknown[] = [];

mock.module("../agent/json-runner", () => ({
  runAgentJson: async (opts: unknown) => {
    jsonRunnerCalls.push(opts);
  },
}));

mock.module("ink", () => ({
  render: (element: unknown) => {
    inkRenderCalls.push(element);
    return {
      waitUntilExit: async () => {},
      unmount: () => {},
      cleanup: () => {},
      rerender: () => {},
      clear: () => {},
    };
  },
}));

import { main } from "../index";

let tempDir: string;
let originalIsTty: boolean | undefined;
let originalCwd: string;
let stderrWrites: string[] = [];
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "non-tty-fallback-"));
  mkdirSync(join(tempDir, "openspec"), { recursive: true });
  writeFileSync(join(tempDir, "package.json"), "{}");
  originalCwd = process.cwd();
  process.chdir(tempDir);
  originalIsTty = process.stdin.isTTY;
  jsonRunnerCalls.length = 0;
  inkRenderCalls.length = 0;
  stderrWrites = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrWrites.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
  Object.defineProperty(process.stdin, "isTTY", {
    value: originalIsTty,
    configurable: true,
    writable: true,
  });
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("agent non-TTY stdin fallback", () => {
  test("falls back to json-runner and emits stderr notice when stdin is not a TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await main(["--project-root", tempDir]);

    expect(jsonRunnerCalls).toHaveLength(1);
    expect(inkRenderCalls).toHaveLength(0);
    expect(stderrWrites.join("")).toContain("stdin is not a TTY");
  });

  test("uses Ink render path when stdin is a TTY and --json-output not passed", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    await main(["--project-root", tempDir]);

    expect(inkRenderCalls).toHaveLength(1);
    expect(jsonRunnerCalls).toHaveLength(0);
    expect(stderrWrites.join("")).not.toContain("stdin is not a TTY");
  });
});
