import { describe, expect, test } from "bun:test";
import { createFakeGh } from "../fake-gh";

describe("createFakeGh", () => {
  test("gh pr create returns scripted url and logs the call", async () => {
    const gh = createFakeGh();
    gh.script({ branch: "feat/x", prUrl: "https://github.com/o/r/pull/7", number: 7 });
    const r = await gh.runner.run(
      ["gh", "pr", "create", "--head", "feat/x", "--title", "t", "--body", "b"],
      "/tmp",
    );
    expect(r.stdout.trim()).toBe("https://github.com/o/r/pull/7");
    expect(gh.calls).toHaveLength(1);
  });

  test("gh pr view returns the scripted JSON", async () => {
    const gh = createFakeGh();
    gh.script({
      branch: "feat/x",
      prUrl: "https://github.com/o/r/pull/7",
      mergeable: "CONFLICTING",
    });
    const r = await gh.runner.run(
      ["gh", "pr", "view", "https://github.com/o/r/pull/7", "--json", "state,mergeable"],
      "/tmp",
    );
    const data = JSON.parse(r.stdout) as { mergeable: string };
    expect(data.mergeable).toBe("CONFLICTING");
  });

  test("gh pr edit --base mutates baseRefName", async () => {
    const gh = createFakeGh();
    gh.script({ branch: "feat/x", prUrl: "https://github.com/o/r/pull/7" });
    await gh.runner.run(
      ["gh", "pr", "edit", "https://github.com/o/r/pull/7", "--base", "develop"],
      "/tmp",
    );
    expect(gh.byBranch().get("feat/x")?.baseRefName).toBe("develop");
  });

  test("gh pr close / merge mutate state", async () => {
    const gh = createFakeGh();
    gh.script({ branch: "feat/x", prUrl: "https://github.com/o/r/pull/7" });
    await gh.runner.run(["gh", "pr", "close", "https://github.com/o/r/pull/7"], "/tmp");
    expect(gh.byBranch().get("feat/x")?.state).toBe("CLOSED");
    gh.script({ branch: "feat/y", prUrl: "https://github.com/o/r/pull/8" });
    await gh.runner.run(["gh", "pr", "merge", "https://github.com/o/r/pull/8"], "/tmp");
    expect(gh.byBranch().get("feat/y")?.state).toBe("MERGED");
  });

  test("gh api throws no-rule by default", async () => {
    const gh = createFakeGh();
    await expect(gh.runner.run(["gh", "api", "/repos/foo"], "/tmp")).rejects.toThrow(/no rule/);
  });

  test("unscripted pr create fails loudly", async () => {
    const gh = createFakeGh();
    await expect(
      gh.runner.run(["gh", "pr", "create", "--head", "missing"], "/tmp"),
    ).rejects.toThrow(/no rule/);
  });
});
