import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { parseWorkflow } from "@ralphy/workflow";
import { buildWorkflowMarkdown } from "@ralphy/workflow/wizard";
import { SetupWizard, EditOrExitPrompt, fieldsForMode, assembleAnswers } from "../SetupWizard";
import { maybeRunSetupWizard } from "../index";

describe("fieldsForMode", () => {
  test("quick/permissive ask only the three common fields", () => {
    expect(fieldsForMode("quick").map((f) => f.id)).toEqual([
      "project.name",
      "linear.team",
      "linear.assignee",
    ]);
    expect(fieldsForMode("permissive").map((f) => f.id)).toEqual(
      fieldsForMode("quick").map((f) => f.id),
    );
  });

  test("customized walks every setting group", () => {
    const ids = fieldsForMode("customized").map((f) => f.id);
    expect(ids).toContain("commands.test");
    expect(ids).toContain("engine");
    expect(ids).toContain("model");
    expect(ids).toContain("createPrOnSuccess");
    expect(ids).toContain("linear.indicatorsPreset");
    expect(ids.length).toBeGreaterThan(fieldsForMode("quick").length);
  });
});

describe("assembleAnswers", () => {
  test("attaches the mode and round-trips through buildWorkflowMarkdown", () => {
    const collected = {
      project: { name: "svc" },
      engine: "codex",
      concurrency: 2,
      linear: { team: "ENG", indicatorsPreset: "status-standard" },
    };
    const answers = assembleAnswers("customized", collected);
    expect(answers.mode).toBe("customized");
    const { config } = parseWorkflow(buildWorkflowMarkdown(answers));
    expect(config.project.name).toBe("svc");
    expect(config.engine).toBe("codex");
    expect(config.concurrency).toBe(2);
    expect(config.linear.team).toBe("ENG");
    expect(config.linear.indicators.getTodo?.filter).toEqual([{ type: "status", value: "Todo" }]);
  });
});

describe("SetupWizard render", () => {
  test("mounts and shows the mode picker", () => {
    const { lastFrame, unmount } = render(createElement(SetupWizard, { onComplete: () => {} }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Ralphy setup");
    expect(frame).toContain("Quick");
    expect(frame).toContain("Customized");
    unmount();
  });

  test("driving quick mode end-to-end produces a valid WORKFLOW.md", async () => {
    const ENTER = "\r";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    let result: string | null = null;
    const { stdin, unmount } = render(
      createElement(SetupWizard, { onComplete: (md: string) => (result = md) }),
    );
    const type = async (text: string) => {
      stdin.write(text);
      await tick();
      stdin.write(ENTER);
      await tick();
    };
    await tick();
    stdin.write(ENTER); // select "quick" (first option)
    await tick();
    await type("demo"); // project name
    await type("ENG"); // linear team
    await type("me"); // linear assignee
    unmount();

    expect(result).not.toBeNull();
    const { config } = parseWorkflow(result!);
    expect(config.project.name).toBe("demo");
    expect(config.linear.team).toBe("ENG");
    expect(config.linear.assignee).toBe("me");
  });

  test("down arrow switches options and enter confirms (mode picker)", async () => {
    const DOWN = "[B";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    const { stdin, lastFrame, unmount } = render(
      createElement(SetupWizard, { onComplete: () => {} }),
    );
    await tick();
    stdin.write(DOWN); // quick -> permissive
    await tick();
    stdin.write(DOWN); // permissive -> customized
    await tick();
    stdin.write("\r"); // confirm customized
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("customized setup — step 1");
    expect(frame).toContain("Project name");
    unmount();
  });

  test("arrows navigate back/forward between answered questions and preserve them", async () => {
    const ENTER = "\r";
    const LEFT = "[D";
    const RIGHT = "[C";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    let result: string | null = null;
    const { stdin, lastFrame, unmount } = render(
      createElement(SetupWizard, { onComplete: (md: string) => (result = md) }),
    );
    await tick();
    stdin.write(ENTER); // quick
    await tick();
    stdin.write("demo"); // project name
    await tick();
    stdin.write(ENTER); // commit name -> team
    await tick();
    stdin.write(LEFT); // back to name (history should show Q1)
    await tick();
    const backFrame = lastFrame() ?? "";
    expect(backFrame).toContain("quick setup — step 1");
    stdin.write(RIGHT); // forward to team again (name preserved)
    await tick();
    stdin.write(ENTER); // team blank -> assignee
    await tick();
    stdin.write("me");
    await tick();
    stdin.write(ENTER); // finalize
    await tick();
    unmount();

    expect(result).not.toBeNull();
    const { config } = parseWorkflow(result!);
    expect(config.project.name).toBe("demo");
    expect(config.linear.assignee).toBe("me");
  });

  test("prefills the first question when started in edit mode", () => {
    const { lastFrame, unmount } = render(
      createElement(SetupWizard, {
        onComplete: () => {},
        initialMode: "customized",
        initialValues: { "project.name": "svc", engine: "codex" },
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("customized setup — step 1");
    expect(frame).toContain("Project name: svc");
    unmount();
  });
});

describe("EditOrExitPrompt", () => {
  test("mounts and reports the chosen option", async () => {
    const DOWN = "[B";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    let choice = "";
    const { stdin, lastFrame, unmount } = render(
      createElement(EditOrExitPrompt, { onChoice: (value: string) => (choice = value) }),
    );
    await tick();
    expect(lastFrame() ?? "").toContain("WORKFLOW.md already exists");
    stdin.write(DOWN); // edit -> exit
    await tick();
    stdin.write("\r");
    await tick();
    unmount();
    expect(choice).toBe("exit");
  });
});

describe("maybeRunSetupWizard gating", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ralphy-init-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns false when WORKFLOW.md already exists", async () => {
    await Bun.write(join(dir, "WORKFLOW.md"), "---\nproject: {}\n---\n");
    expect(await maybeRunSetupWizard(dir)).toBe(false);
  });

  test("returns false (no write) in a non-interactive shell", async () => {
    // The test runner is not a TTY, so the wizard must not render or write.
    expect(await maybeRunSetupWizard(dir)).toBe(false);
    expect(await Bun.file(join(dir, "WORKFLOW.md")).exists()).toBe(false);
  });
});
