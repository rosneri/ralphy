import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "..", "block-protected-edits.sh");
const SETTINGS = join(import.meta.dirname, "..", "..", "settings.json");

/** Runs the hook with the given tool-input JSON on stdin and returns the exit code. */
async function runHook(toolInput: Record<string, unknown>): Promise<number> {
  const payload = JSON.stringify({ tool_name: "Edit", tool_input: toolInput });
  const proc = Bun.spawn(["bash", HOOK], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exited;
}

describe("block-protected-edits hook", () => {
  it("blocks editing a frozen validation script (exit 2)", async () => {
    expect(await runHook({ file_path: "scripts/check-folder-size.ts" })).toBe(2);
  });

  it("blocks a worktree-prefixed frozen path (exit 2)", async () => {
    expect(await runHook({ file_path: ".claude/worktrees/rlf-210/scripts/check-shell.sh" })).toBe(
      2,
    );
  });

  it("blocks an absolute frozen path (exit 2)", async () => {
    expect(await runHook({ file_path: "/Users/dev/ralphy/scripts/check-no-direct-http.ts" })).toBe(
      2,
    );
  });

  it("allows a new, non-frozen script (exit 0)", async () => {
    expect(await runHook({ file_path: "scripts/check-foo.ts" })).toBe(0);
  });

  it("allows editing ci-local.sh (exit 0)", async () => {
    expect(await runHook({ file_path: "scripts/ci-local.sh" })).toBe(0);
  });

  it("allows a non-script file (exit 0)", async () => {
    expect(await runHook({ file_path: "packages/core/src/loop.ts" })).toBe(0);
  });

  it("allows an empty file_path (exit 0)", async () => {
    expect(await runHook({ file_path: "" })).toBe(0);
  });

  it("allows a missing file_path (exit 0)", async () => {
    expect(await runHook({})).toBe(0);
  });

  it("does not block a frozen basename outside scripts/ (exit 0)", async () => {
    expect(await runHook({ file_path: "docs/check-shell.sh" })).toBe(0);
  });

  it("emits a reason to stderr when blocking", async () => {
    const payload = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "scripts/check-shell.sh" },
    });
    const proc = Bun.spawn(["bash", HOOK], {
      stdin: new TextEncoder().encode(payload),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(stderr).toContain("check-shell.sh");
    expect(stderr.toLowerCase()).toContain("frozen");
  });
});

describe(".claude/settings.json", () => {
  it("is valid JSON and registers the Edit|Write|MultiEdit matcher", async () => {
    const settings = JSON.parse(await Bun.file(SETTINGS).text());
    const preToolUse: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> =
      settings.hooks.PreToolUse;
    const matcher = preToolUse.find((m) => m.matcher === "Edit|Write|MultiEdit");
    expect(matcher).toBeDefined();
    expect(matcher?.hooks?.[0]?.command).toContain("block-protected-edits.sh");
    // The pre-existing Bash matcher must remain untouched.
    expect(preToolUse.some((m) => m.matcher === "Bash")).toBe(true);
  });
});
