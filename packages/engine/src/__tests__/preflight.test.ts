import { describe, expect, test, mock, beforeEach } from "bun:test";

interface MockProc {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
}

interface SpawnOptions {
  cmd: string[];
  env?: Record<string, string | undefined>;
  [key: string]: unknown;
}

interface SpawnCall {
  cmd: string[];
  env?: Record<string, string | undefined>;
}

let nextResults: Array<{ exitCode: number; stdout?: string }> = [];
const spawnCalls: SpawnCall[] = [];

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

const spawnMock = mock((options: SpawnOptions): MockProc => {
  spawnCalls.push(options.env ? { cmd: options.cmd, env: options.env } : { cmd: options.cmd });
  const next = nextResults.shift() ?? { exitCode: 0, stdout: "" };
  return {
    stdout: streamFrom(next.stdout ?? ""),
    stderr: streamFrom(""),
    exited: Promise.resolve(next.exitCode),
  };
});

mock.module("../spawn", () => ({ spawn: spawnMock }));

const {
  scrubClaudeEnv,
  CLAUDE_ENV_KEYS_TO_SCRUB,
  checkGhAuth,
  GH_AUTH_FAIL_MESSAGE,
  checkClaudeAuth,
  CLAUDE_AUTH_FAIL_MESSAGE,
  runPreflight,
} = await import("../preflight");

beforeEach(() => {
  nextResults = [];
  spawnCalls.length = 0;
  spawnMock.mockClear();
});

describe("scrubClaudeEnv", () => {
  test("removes the documented keys", () => {
    const env = {
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "abc",
      CLAUDE_CODE_EXECPATH: "/x",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      AI_AGENT: "claude-code",
      OTHER: "kept",
    };
    const out = scrubClaudeEnv(env);
    expect(out.PATH).toBe("/usr/bin");
    expect(out.OTHER).toBe("kept");
    for (const key of CLAUDE_ENV_KEYS_TO_SCRUB) {
      expect(out[key]).toBeUndefined();
    }
  });

  test("preserves keys that are not in the scrub list", () => {
    const env = { CUSTOM: "ok", HOME: "/h" };
    const out = scrubClaudeEnv(env);
    expect(out).toEqual(env);
  });

  test("does not mutate the input env", () => {
    const env: Record<string, string | undefined> = { CLAUDECODE: "1", KEEP: "yes" };
    scrubClaudeEnv(env);
    expect(env.CLAUDECODE).toBe("1");
  });
});

describe("checkGhAuth", () => {
  test("returns ok on exit 0", async () => {
    nextResults.push({ exitCode: 0 });
    const res = await checkGhAuth();
    expect(res.ok).toBe(true);
    expect(spawnCalls[0]!.cmd).toEqual(["gh", "auth", "status"]);
  });

  test("returns failure on non-zero exit", async () => {
    nextResults.push({ exitCode: 1 });
    const res = await checkGhAuth();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tool).toBe("gh");
      expect(res.message).toBe(GH_AUTH_FAIL_MESSAGE);
      expect(res.message).toContain("gh is not authenticated");
      expect(res.message).toContain("gh auth login");
    }
  });
});

describe("checkClaudeAuth", () => {
  test("returns ok on clean stdout", async () => {
    nextResults.push({ exitCode: 0, stdout: "ok\n" });
    const res = await checkClaudeAuth();
    expect(res.ok).toBe(true);
  });

  test("returns failure when stdout matches Not logged in even with exit 0", async () => {
    nextResults.push({ exitCode: 0, stdout: "Not logged in\n" });
    const res = await checkClaudeAuth();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tool).toBe("claude");
      expect(res.message).toBe(CLAUDE_AUTH_FAIL_MESSAGE);
      expect(res.message).toContain("claude CLI is not authenticated");
      expect(res.message).toContain("/login");
    }
  });

  test("returns failure when stdout matches Please run /login", async () => {
    nextResults.push({ exitCode: 0, stdout: "Please run /login first" });
    const res = await checkClaudeAuth();
    expect(res.ok).toBe(false);
  });

  test("returns failure on non-zero exit", async () => {
    nextResults.push({ exitCode: 1, stdout: "" });
    const res = await checkClaudeAuth();
    expect(res.ok).toBe(false);
  });

  test("spawns with scrubbed env (no CLAUDECODE)", async () => {
    const original = process.env["CLAUDECODE"];
    process.env["CLAUDECODE"] = "1";
    nextResults.push({ exitCode: 0, stdout: "ok" });
    await checkClaudeAuth();
    if (original === undefined) delete process.env["CLAUDECODE"];
    else process.env["CLAUDECODE"] = original;
    const env = spawnCalls[0]!.env!;
    expect(env["CLAUDECODE"]).toBeUndefined();
  });
});

describe("runPreflight", () => {
  test("short-circuits on gh failure (does not call claude probe)", async () => {
    nextResults.push({ exitCode: 1 });
    const res = await runPreflight();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.tool).toBe("gh");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cmd[0]).toBe("gh");
  });

  test("runs claude probe when gh succeeds", async () => {
    nextResults.push({ exitCode: 0 });
    nextResults.push({ exitCode: 0, stdout: "ok" });
    const res = await runPreflight();
    expect(res.ok).toBe(true);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1]!.cmd[0]).toBe("claude");
  });

  test("returns claude failure when gh passes and claude fails", async () => {
    nextResults.push({ exitCode: 0 });
    nextResults.push({ exitCode: 0, stdout: "Not logged in" });
    const res = await runPreflight();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.tool).toBe("claude");
  });
});
