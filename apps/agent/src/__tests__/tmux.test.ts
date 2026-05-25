import { describe, it, expect, beforeEach, afterEach } from "bun:test";

type SpawnResult = { exitCode: number; stdout: string; stderr: string };

const spawnCalls: { cmd: string[] }[] = [];
let nextSpawnResult: SpawnResult = { exitCode: 0, stdout: "", stderr: "" };
const encoder = new TextEncoder();

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

const {
  sessionName,
  sessionExists,
  getSessionStatus,
  createSession,
  tmuxAvailable,
  isInsideTmux,
  killSession,
} = await import("../runtime/tmux");

beforeEach(() => {
  spawnCalls.length = 0;
  nextSpawnResult = { exitCode: 0, stdout: "", stderr: "" };
});

describe("sessionName", () => {
  const originalEnv = process.env["RALPH_SESSION_NAME"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["RALPH_SESSION_NAME"];
    } else {
      process.env["RALPH_SESSION_NAME"] = originalEnv;
    }
  });

  it("derives name from projectRoot basename", () => {
    delete process.env["RALPH_SESSION_NAME"];
    expect(sessionName("/home/user/my-project")).toBe("ralphy-agent-my-project");
  });

  it("uses RALPH_SESSION_NAME override when set", () => {
    process.env["RALPH_SESSION_NAME"] = "custom-session";
    expect(sessionName("/home/user/my-project")).toBe("custom-session");
  });

  it("handles nested paths correctly", () => {
    delete process.env["RALPH_SESSION_NAME"];
    expect(sessionName("/a/b/c/my-app")).toBe("ralphy-agent-my-app");
  });
});

describe("sessionExists", () => {
  it("returns true when tmux has-session exits 0", () => {
    nextSpawnResult = { exitCode: 0, stdout: "", stderr: "" };
    expect(sessionExists("my-session")).toBe(true);
    expect(spawnCalls[0]?.cmd).toEqual(["tmux", "has-session", "-t", "my-session"]);
  });

  it("returns false when tmux has-session exits non-zero", () => {
    nextSpawnResult = { exitCode: 1, stdout: "", stderr: "" };
    expect(sessionExists("my-session")).toBe(false);
  });
});

describe("getSessionStatus", () => {
  it("returns exists:false when list-sessions exits non-zero", () => {
    nextSpawnResult = { exitCode: 1, stdout: "", stderr: "" };
    const status = getSessionStatus("ralphy-agent-foo");
    expect(status).toEqual({ exists: false, attached: false, name: "ralphy-agent-foo" });
  });

  it("returns exists:true, attached:false when session is not attached", () => {
    nextSpawnResult = { exitCode: 0, stdout: "ralphy-agent-foo 0\nother-session 1\n", stderr: "" };
    const status = getSessionStatus("ralphy-agent-foo");
    expect(status).toEqual({ exists: true, attached: false, name: "ralphy-agent-foo" });
  });

  it("returns exists:true, attached:true when session is attached", () => {
    nextSpawnResult = { exitCode: 0, stdout: "ralphy-agent-foo 2\n", stderr: "" };
    const status = getSessionStatus("ralphy-agent-foo");
    expect(status).toEqual({ exists: true, attached: true, name: "ralphy-agent-foo" });
  });

  it("returns exists:false when name not found in session list", () => {
    nextSpawnResult = { exitCode: 0, stdout: "other-session 1\n", stderr: "" };
    const status = getSessionStatus("ralphy-agent-foo");
    expect(status).toEqual({ exists: false, attached: false, name: "ralphy-agent-foo" });
  });
});

describe("createSession", () => {
  it("passes env vars as -e key=value arguments", () => {
    nextSpawnResult = { exitCode: 0, stdout: "", stderr: "" };
    createSession("my-session", ["ralph", "agent"], { RALPH_AGENT_MANAGED: "1" });
    expect(spawnCalls[0]?.cmd).toEqual([
      "tmux",
      "new-session",
      "-d",
      "-s",
      "my-session",
      "-e",
      "RALPH_AGENT_MANAGED=1",
      "ralph",
      "agent",
    ]);
  });

  it("throws when exit != 0 and no duplicate session error", () => {
    nextSpawnResult = { exitCode: 1, stdout: "", stderr: "some other error" };
    expect(() => createSession("my-session", ["ralph", "agent"], {})).toThrow(
      "tmux new-session failed",
    );
    // stderr detail available on err.stderr (not in message, per static-message rule)
  });

  it("does not throw on duplicate session error (race condition safety)", () => {
    nextSpawnResult = { exitCode: 1, stdout: "", stderr: "duplicate session: my-session" };
    expect(() => createSession("my-session", ["ralph", "agent"], {})).not.toThrow();
  });
});

describe("tmuxAvailable", () => {
  it("returns true when tmux -V exits 0", () => {
    nextSpawnResult = { exitCode: 0, stdout: "tmux 3.3a", stderr: "" };
    expect(tmuxAvailable()).toBe(true);
  });

  it("returns false when tmux -V exits non-zero", () => {
    nextSpawnResult = { exitCode: 127, stdout: "", stderr: "" };
    expect(tmuxAvailable()).toBe(false);
  });
});

describe("isInsideTmux", () => {
  const originalTmux = process.env["TMUX"];

  afterEach(() => {
    if (originalTmux === undefined) {
      delete process.env["TMUX"];
    } else {
      process.env["TMUX"] = originalTmux;
    }
  });

  it("returns true when TMUX env var is set", () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,12345,0";
    expect(isInsideTmux()).toBe(true);
  });

  it("returns false when TMUX env var is not set", () => {
    delete process.env["TMUX"];
    expect(isInsideTmux()).toBe(false);
  });
});

describe("killSession", () => {
  it("returns true when kill-session exits 0", () => {
    nextSpawnResult = { exitCode: 0, stdout: "", stderr: "" };
    expect(killSession("my-session")).toBe(true);
    expect(spawnCalls[0]?.cmd).toEqual(["tmux", "kill-session", "-t", "my-session"]);
  });

  it("returns false when kill-session exits non-zero", () => {
    nextSpawnResult = { exitCode: 1, stdout: "", stderr: "session not found" };
    expect(killSession("my-session")).toBe(false);
  });
});
