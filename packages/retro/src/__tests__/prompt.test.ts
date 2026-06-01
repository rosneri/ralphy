import { describe, expect, it } from "bun:test";
import { buildRetroPrompt } from "../prompt";
import type { RetroContext } from "../types";

function ctx(overrides: Partial<RetroContext> = {}): RetroContext {
  return {
    identifier: "RLF-212",
    changeName: "rlf-212-post-ticket-retrospective-analysis-agent",
    cwd: "/work/tree",
    engine: "claude",
    model: "opus",
    exitCode: 0,
    prUrl: "https://github.com/acme/repo/pull/42",
    date: "2026-06-01",
    ticketDigest: "Title: Retrospective agent\n\nDo the thing.",
    paths: {
      changeDir: "/work/tree/openspec/changes/rlf-212",
      stateFilePath: "/states/rlf-212/.ralph-state.json",
      logFile: "/logs/rlf-212.log",
      jsonLogFile: "/logs/events.jsonl",
      agentStateFile: "/work/tree/.ralph/agent-state.json",
    },
    ...overrides,
  };
}

describe("buildRetroPrompt", () => {
  it("embeds every data-source path", () => {
    const c = ctx();
    const out = buildRetroPrompt(c, "/out/RLF-212-2026-06-01.md");
    expect(out).toContain(c.paths.changeDir);
    expect(out).toContain(c.paths.stateFilePath);
    expect(out).toContain(c.paths.logFile!);
    expect(out).toContain(c.paths.jsonLogFile!);
    expect(out).toContain(c.paths.agentStateFile!);
  });

  it("embeds the ticket digest, identifier, disposition and PR url", () => {
    const out = buildRetroPrompt(ctx(), "/out/report.md");
    expect(out).toContain("Title: Retrospective agent");
    expect(out).toContain("RLF-212");
    expect(out).toContain("done");
    expect(out).toContain("https://github.com/acme/repo/pull/42");
  });

  it("embeds the exact output path and the write instruction", () => {
    const outputPath = "/out/RLF-212-2026-06-01.md";
    const out = buildRetroPrompt(ctx(), outputPath);
    expect(out).toContain(outputPath);
    expect(out.toLowerCase()).toContain("write");
  });

  it("includes an explicit no-side-effects rule", () => {
    const out = buildRetroPrompt(ctx(), "/out/report.md");
    expect(out).toContain("Hard rules");
    expect(out.toLowerCase()).toContain("do not run any git");
    expect(out.toLowerCase()).toContain("pull request");
  });

  it("marks an unavailable path explicitly instead of omitting it", () => {
    const out = buildRetroPrompt(ctx({ paths: { ...ctx().paths, logFile: null } }), "/out/r.md");
    expect(out).toContain("unavailable");
  });

  it("notes when no PR was opened", () => {
    const out = buildRetroPrompt(ctx({ prUrl: null }), "/out/r.md");
    expect(out).toContain("none was opened");
    expect(out).toContain("no PR");
  });

  it("reflects a non-zero disposition", () => {
    const out = buildRetroPrompt(ctx({ exitCode: 70 }), "/out/r.md");
    expect(out).toContain("ci-failed");
    expect(out).toContain("exit code 70");
  });
});
