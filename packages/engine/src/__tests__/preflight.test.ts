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
  checkRepoWriteAccess,
  REPO_WRITE_FAIL_MESSAGE,
  scrubGithubAppTokenEnv,
  checkTokenade,
  TOKENADE_MISSING_MESSAGE,
  TOKENADE_UNHEALTHY_MESSAGE,
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

  test("returns failure when spawn throws (catch branch)", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT: gh not found");
    });
    const res = await checkGhAuth();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tool).toBe("gh");
      expect(res.message).toBe(GH_AUTH_FAIL_MESSAGE);
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

  test("returns failure when spawn throws (catch branch)", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT: claude not found");
    });
    const res = await checkClaudeAuth();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tool).toBe("claude");
      expect(res.message).toBe(CLAUDE_AUTH_FAIL_MESSAGE);
    }
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

describe("scrubGithubAppTokenEnv", () => {
  test("drops GITHUB_TOKEN but keeps GH_TOKEN and everything else", () => {
    const out = scrubGithubAppTokenEnv({
      GITHUB_TOKEN: "github_pat_app_secret",
      GH_TOKEN: "gho_gh_login",
      PATH: "/usr/bin",
    });
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.GH_TOKEN).toBe("gho_gh_login");
    expect(out.PATH).toBe("/usr/bin");
  });

  test("does not mutate the input env", () => {
    const env: Record<string, string | undefined> = { GITHUB_TOKEN: "x", KEEP: "y" };
    scrubGithubAppTokenEnv(env);
    expect(env.GITHUB_TOKEN).toBe("x");
  });
});

// gh api prints the JSON error BODY to stdout on a non-2xx, so the probe
// discriminates on the `"status"` field. The all-zero sha never mutates.
const WRITABLE_BODY = '{"message":"Object does not exist","status":"422"}';
const NO_WRITE_BODY =
  '{"message":"Resource not accessible by personal access token","status":"403"}';

describe("checkRepoWriteAccess", () => {
  test("ok when the write-probe is rejected on the sha (422 = token CAN write)", async () => {
    nextResults.push({ exitCode: 1, stdout: WRITABLE_BODY });
    const res = await checkRepoWriteAccess("/repo");
    expect(res.ok).toBe(true);
    // Probes via create-ref with an all-zero sha — never mutates.
    expect(spawnCalls[0]!.cmd.slice(0, 5)).toEqual([
      "gh",
      "api",
      "-X",
      "POST",
      "repos/{owner}/{repo}/git/refs",
    ]);
    expect(spawnCalls[0]!.cmd.join(" ")).toContain("sha=0000000000000000000000000000000000000000");
  });

  test("fails when the credential is rejected at the permission gate (403)", async () => {
    nextResults.push({ exitCode: 1, stdout: NO_WRITE_BODY });
    const res = await checkRepoWriteAccess("/repo");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tool).toBe("repo");
      expect(res.message).toBe(REPO_WRITE_FAIL_MESSAGE);
      expect(res.message).toContain("write access");
    }
  });

  test("fails on the literal git push 403 wording too", async () => {
    nextResults.push({ exitCode: 1, stdout: "remote: Write access to repository not granted." });
    const res = await checkRepoWriteAccess("/repo");
    expect(res.ok).toBe(false);
  });

  test("does NOT halt on an ambiguous outcome (e.g. 404 / network)", async () => {
    nextResults.push({ exitCode: 1, stdout: '{"message":"Not Found","status":"404"}' });
    const res = await checkRepoWriteAccess("/repo");
    expect(res.ok).toBe(true);
  });

  test("does not halt when spawn throws (gh-auth preflight covers a missing gh)", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT: gh not found");
    });
    const res = await checkRepoWriteAccess("/repo");
    expect(res.ok).toBe(true);
  });

  test("scrubs GITHUB_TOKEN from the probe env (checks gh's own credential)", async () => {
    const original = process.env["GITHUB_TOKEN"];
    process.env["GITHUB_TOKEN"] = "github_pat_app_secret";
    nextResults.push({ exitCode: 1, stdout: WRITABLE_BODY });
    await checkRepoWriteAccess("/repo");
    if (original === undefined) delete process.env["GITHUB_TOKEN"];
    else process.env["GITHUB_TOKEN"] = original;
    expect(spawnCalls[0]!.env!["GITHUB_TOKEN"]).toBeUndefined();
  });
});

describe("runPreflight", () => {
  test("runs the repo-write check after gh+claude when requireRepoWrite is set", async () => {
    nextResults.push({ exitCode: 0 }); // gh auth
    nextResults.push({ exitCode: 0, stdout: "ok" }); // claude
    nextResults.push({ exitCode: 1, stdout: NO_WRITE_BODY }); // repo: no write
    const res = await runPreflight({ requireRepoWrite: true, repoCwd: "/repo" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.tool).toBe("repo");
    expect(spawnCalls).toHaveLength(3);
    expect(spawnCalls[2]!.cmd.slice(0, 2)).toEqual(["gh", "api"]);
  });

  test("passes when requireRepoWrite is set and the repo is writable", async () => {
    nextResults.push({ exitCode: 0 }); // gh auth
    nextResults.push({ exitCode: 0, stdout: "ok" }); // claude
    nextResults.push({ exitCode: 1, stdout: WRITABLE_BODY }); // repo: writable
    const res = await runPreflight({ requireRepoWrite: true, repoCwd: "/repo" });
    expect(res.ok).toBe(true);
    expect(spawnCalls).toHaveLength(3);
  });

  test("skips the repo-write check when requireRepoWrite is falsy", async () => {
    nextResults.push({ exitCode: 0 }); // gh auth
    nextResults.push({ exitCode: 0, stdout: "ok" }); // claude
    const res = await runPreflight();
    expect(res.ok).toBe(true);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls.every((c) => c.cmd.slice(0, 2).join(" ") !== "gh api")).toBe(true);
  });

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

describe("checkTokenade", () => {
  test("ok when healthcheck exits 0", async () => {
    nextResults.push({ exitCode: 0 });
    const res = await checkTokenade();
    expect(res.ok).toBe(true);
    expect(spawnCalls[0]!.cmd).toEqual(["tokenade", "healthcheck"]);
  });

  test("reports the binary as missing on a command-not-found exit", async () => {
    nextResults.push({ exitCode: 127 });
    const res = await checkTokenade();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tool).toBe("tokenade");
      expect(res.message).toBe(TOKENADE_MISSING_MESSAGE);
      expect(res.message).toContain("npm install -g @tokenade/cli");
    }
  });

  test("reports the binary as missing when spawn throws (ENOENT)", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT: tokenade not found");
    });
    const res = await checkTokenade();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe(TOKENADE_MISSING_MESSAGE);
  });

  test("distinguishes installed-but-unhealthy from missing", async () => {
    nextResults.push({ exitCode: 1 });
    const res = await checkTokenade();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tool).toBe("tokenade");
      expect(res.message).toBe(TOKENADE_UNHEALTHY_MESSAGE);
      expect(res.message).toContain("tokenade login");
    }
  });
});

describe("runPreflight — tokenade", () => {
  test("skips the probe entirely when tokenade is disabled", async () => {
    nextResults.push({ exitCode: 0 }); // gh
    nextResults.push({ exitCode: 0, stdout: "ok" }); // claude
    const res = await runPreflight({ tokenade: { enabled: false, required: false } });
    expect(res.ok).toBe(true);
    expect(spawnCalls).toHaveLength(2);
  });

  test("probes tokenade last, after gh and claude", async () => {
    nextResults.push({ exitCode: 0 }); // gh
    nextResults.push({ exitCode: 0, stdout: "ok" }); // claude
    nextResults.push({ exitCode: 0 }); // tokenade
    const res = await runPreflight({ tokenade: { enabled: true, required: false } });
    expect(res.ok).toBe(true);
    expect(spawnCalls).toHaveLength(3);
    expect(spawnCalls[2]!.cmd).toEqual(["tokenade", "healthcheck"]);
  });

  test("warns instead of halting when tokenade is absent and not required", async () => {
    nextResults.push({ exitCode: 0 }); // gh
    nextResults.push({ exitCode: 0, stdout: "ok" }); // claude
    nextResults.push({ exitCode: 127 }); // tokenade missing
    const warnings: string[] = [];
    const res = await runPreflight({
      tokenade: { enabled: true, required: false },
      onWarning: (message) => warnings.push(message),
    });
    expect(res.ok).toBe(true);
    expect(warnings).toEqual([TOKENADE_MISSING_MESSAGE]);
  });

  test("halts and does not warn when tokenade is required", async () => {
    nextResults.push({ exitCode: 0 }); // gh
    nextResults.push({ exitCode: 0, stdout: "ok" }); // claude
    nextResults.push({ exitCode: 127 }); // tokenade missing
    const warnings: string[] = [];
    const res = await runPreflight({
      tokenade: { enabled: true, required: true },
      onWarning: (message) => warnings.push(message),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.tool).toBe("tokenade");
    expect(warnings).toEqual([]);
  });

  test("emits no warning when an enabled tokenade is healthy", async () => {
    nextResults.push({ exitCode: 0 });
    nextResults.push({ exitCode: 0, stdout: "ok" });
    nextResults.push({ exitCode: 0 });
    const warnings: string[] = [];
    const res = await runPreflight({
      tokenade: { enabled: true, required: false },
      onWarning: (message) => warnings.push(message),
    });
    expect(res.ok).toBe(true);
    expect(warnings).toEqual([]);
  });
});
