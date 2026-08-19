import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { TokenadeSettings } from "../tokenade";

interface MockProc {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
}

interface SpawnOptions {
  cmd: string[];
  cwd?: string;
  [key: string]: unknown;
}

const spawnCalls: SpawnOptions[] = [];
let nextExitCodes: number[] = [];

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

const spawnMock = mock((options: SpawnOptions): MockProc => {
  spawnCalls.push(options);
  return {
    stdout: emptyStream(),
    stderr: emptyStream(),
    exited: Promise.resolve(nextExitCodes.shift() ?? 0),
  };
});

mock.module("../spawn", () => ({ spawn: spawnMock }));

const { tokenadeEnvironment, applyTokenadeEnvironment, warmTokenadeIndex } =
  await import("../tokenade");

/** The schema default: opt-in, non-fatal, warms worktrees. */
const disabled: TokenadeSettings = { enabled: false, required: false, indexWorktrees: true };
const enabled: TokenadeSettings = { enabled: true, required: false, indexWorktrees: true };

beforeEach(() => {
  spawnCalls.length = 0;
  nextExitCodes = [];
  spawnMock.mockClear();
  delete process.env["TOKENADE_READ_MODE"];
});

describe("tokenadeEnvironment", () => {
  test("is empty when disabled, even with a read mode set", () => {
    expect(tokenadeEnvironment({ ...disabled, readMode: "aggressive" })).toEqual({});
  });

  test("is empty when enabled without a read mode — tokenade keeps its own default", () => {
    expect(tokenadeEnvironment(enabled)).toEqual({});
  });

  test("maps readMode onto TOKENADE_READ_MODE when enabled", () => {
    expect(tokenadeEnvironment({ ...enabled, readMode: "reference" })).toEqual({
      TOKENADE_READ_MODE: "reference",
    });
  });
});

describe("applyTokenadeEnvironment", () => {
  test("publishes the read mode onto process.env for descendants to inherit", () => {
    applyTokenadeEnvironment({ ...enabled, readMode: "task" });
    expect(process.env["TOKENADE_READ_MODE"]).toBe("task");
  });

  test("sets nothing when disabled — there is no force-off value", () => {
    applyTokenadeEnvironment({ ...disabled, readMode: "task" });
    expect(process.env["TOKENADE_READ_MODE"]).toBeUndefined();
  });
});

describe("warmTokenadeIndex", () => {
  test("does not spawn when tokenade is disabled", async () => {
    const res = await warmTokenadeIndex("/repo/wt", disabled);
    expect(res).toEqual({ indexed: false, message: null });
    expect(spawnCalls).toHaveLength(0);
  });

  test("does not spawn when indexWorktrees is off", async () => {
    const res = await warmTokenadeIndex("/repo/wt", { ...enabled, indexWorktrees: false });
    expect(res).toEqual({ indexed: false, message: null });
    expect(spawnCalls).toHaveLength(0);
  });

  test("runs `tokenade index` in the worktree and reports success", async () => {
    nextExitCodes.push(0);
    const res = await warmTokenadeIndex("/repo/wt", enabled);
    expect(res).toEqual({ indexed: true, message: null });
    expect(spawnCalls[0]!.cmd).toEqual(["tokenade", "index"]);
    expect(spawnCalls[0]!.cwd).toBe("/repo/wt");
  });

  test("degrades to a message on a non-zero exit rather than throwing", async () => {
    nextExitCodes.push(3);
    const res = await warmTokenadeIndex("/repo/wt", enabled);
    expect(res.indexed).toBe(false);
    expect(res.message).toContain("exited 3");
    expect(res.message).toContain("/repo/wt");
  });

  test("degrades to a message when the binary is missing (spawn throws)", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT: tokenade not found");
    });
    const res = await warmTokenadeIndex("/repo/wt", enabled);
    expect(res.indexed).toBe(false);
    expect(res.message).toContain("ENOENT");
  });
});
