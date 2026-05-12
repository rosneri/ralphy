import { describe, expect, test } from "bun:test";
import { resolveOpenspecBin, ensureOpenspecInstalled, type InstallRunner } from "../openspec-bin";

class FakeRunner implements InstallRunner {
  logs: string[] = [];
  calls: { cmd: string[]; cwd: string }[] = [];
  resolveAttempts = 0;
  /** Sequence of behaviors per resolveSync call. */
  resolveOutcomes: ("missing" | string)[] = [];
  /** Sequence of exit codes per spawnSync call. */
  spawnOutcomes: number[] = [];

  spawnSync(cmd: string[], cwd: string): { exitCode: number | null } {
    this.calls.push({ cmd, cwd });
    const next = this.spawnOutcomes.shift() ?? 1;
    return { exitCode: next };
  }

  resolveSync(_specifier: string, _fromDir: string): string {
    this.resolveAttempts++;
    const outcome = this.resolveOutcomes.shift();
    if (outcome === undefined || outcome === "missing") {
      const err = new Error("Cannot find module") as Error & { code?: string };
      err.code = "MODULE_NOT_FOUND";
      throw err;
    }
    return outcome;
  }

  log(text: string): void {
    this.logs.push(text);
  }
}

describe("resolveOpenspecBin", () => {
  test("returns the bin path when resolveSync succeeds", () => {
    const r = new FakeRunner();
    r.resolveOutcomes = ["/some/where/node_modules/@fission-ai/openspec/package.json"];

    const bin = resolveOpenspecBin("/start/dir", r);

    expect(bin).toBe("/some/where/node_modules/@fission-ai/openspec/bin/openspec.js");
    expect(r.calls).toHaveLength(0);
  });

  test("auto-installs and retries when resolveSync first fails", () => {
    const r = new FakeRunner();
    r.resolveOutcomes = ["missing", "/install/dir/node_modules/@fission-ai/openspec/package.json"];
    r.spawnOutcomes = [0];

    const bin = resolveOpenspecBin("/start/dir", r);

    expect(bin).toBe("/install/dir/node_modules/@fission-ai/openspec/bin/openspec.js");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.cmd[0]).toBe("npm");
    expect(r.calls[0]!.cmd).toContain("@fission-ai/openspec@latest");
    expect(r.logs.join("")).toContain("installing automatically");
  });

  test("falls back to bun add when npm install fails", () => {
    const r = new FakeRunner();
    r.resolveOutcomes = ["missing", "/install/dir/node_modules/@fission-ai/openspec/package.json"];
    r.spawnOutcomes = [1, 0];

    resolveOpenspecBin("/start/dir", r);

    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]!.cmd[0]).toBe("npm");
    expect(r.calls[1]!.cmd[0]).toBe("bun");
  });

  test("throws when both install candidates fail", () => {
    const r = new FakeRunner();
    r.resolveOutcomes = ["missing"];
    r.spawnOutcomes = [1, 1];

    expect(() => ensureOpenspecInstalled("/start/dir", r)).toThrow("openspec auto-install failed");
  });
});
