import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { parseWorkflow } from "@ralphy/workflow";
import {
  applyAnswersToWorkflow,
  buildWorkflowMarkdown,
  indicatorsForPreset,
} from "@ralphy/workflow/wizard";
import { fieldsForMode } from "@ralphy/workflow/fields";
import {
  SetupWizard,
  EditOrExitPrompt,
  MigratePrompt,
  RecreateOrExitPrompt,
  IndicatorBuilder,
  assembleAnswers,
} from "../SetupWizard";
import type { IndicatorMap } from "@ralphy/workflow/wizard-types";
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
    expect(ids).toContain("linear.indicators");
    expect(ids).toContain("linear.confirmationMode.enabled");
    expect(ids.length).toBeGreaterThan(fieldsForMode("quick").length);
  });

  test("gated sub-fields only appear when their section is enabled", () => {
    const off = fieldsForMode("customized", {}).map((f) => f.id);
    expect(off).not.toContain("stackPrsOnDependencies");
    expect(off).not.toContain("linear.confirmationMode.timeoutHours");

    const on = fieldsForMode("customized", {
      createPrOnSuccess: true,
      "linear.confirmationMode.enabled": true,
    }).map((f) => f.id);
    expect(on).toContain("stackPrsOnDependencies");
    expect(on).toContain("autoMergeStrategy");
    expect(on).toContain("linear.confirmationMode.timeoutHours");
  });
});

describe("assembleAnswers", () => {
  test("attaches the mode and round-trips through buildWorkflowMarkdown", () => {
    const values = {
      "project.name": "svc",
      engine: "codex",
      concurrency: 2,
      "linear.team": "ENG",
      "linear.indicators": indicatorsForPreset("status-standard"),
    };
    const answers = assembleAnswers("customized", values);
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
    expect(frame).toContain("customized · step 1");
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
    expect(backFrame).toContain("quick · step 1");
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

  test("onlyFields restricts the walkthrough to the migration diff", () => {
    const { lastFrame, unmount } = render(
      createElement(SetupWizard, {
        onComplete: () => {},
        initialMode: "customized",
        onlyFields: ["stackPrsOnDependencies", "prTracker.enabled"],
        initialValues: { createPrOnSuccess: true },
      }),
    );
    const plain = (lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    // First (and only initially-visible) diff field, not the catalogue's first.
    expect(plain).toContain("step 1/2");
    expect(plain).toContain("Stack dependent issues' PRs");
    unmount();
  });

  test("diff mode writes only the diff field, not the prefilled defaults", async () => {
    const UP = "\x1b[A";
    const ENTER = "\r";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    // Sparse legacy file: no version, no engine/model materialized.
    const legacy = ["---", "project:", "  name: my-app", "---", "Body."].join("\n");
    let result: string | null = null;
    const { stdin, unmount } = render(
      createElement(SetupWizard, {
        onComplete: (md: string) => (result = md),
        initialMode: "customized",
        onlyFields: ["linear.confirmationMode.enabled"],
        // Prefill mirrors initialValuesFromConfig — present for gating only.
        initialValues: { engine: "claude", model: "opus", createPrOnSuccess: false },
        buildMarkdown: (answers) => applyAnswersToWorkflow(legacy, answers),
      }),
    );
    await tick();
    stdin.write(UP); // confirm: No(default) -> Yes
    await tick();
    stdin.write(ENTER); // commit the only diff field -> complete
    await tick();
    unmount();

    expect(result).not.toBeNull();
    const md = result!;
    // The diff field is written...
    expect(md).toContain("confirmationMode:");
    expect(parseWorkflow(md).config.linear.confirmationMode.enabled).toBe(true);
    // ...but the prefilled, non-diff defaults are NOT materialized into the file.
    expect(md).not.toContain("engine:");
    expect(md).not.toContain("createPrOnSuccess:");
    // Legacy content is preserved.
    expect(md).toContain("name: my-app");
  });

  test("the prompt-body step pre-fills the body and replaces it on Ctrl-D", async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    const captured: { md: string | null } = { md: null };
    const { stdin, lastFrame, unmount } = render(
      createElement(SetupWizard, {
        onComplete: (md: string) => {
          captured.md = md;
        },
        initialMode: "customized",
        onlyFields: ["promptBody"],
        initialBody: "default body",
        buildMarkdown: (_answers: unknown, body?: string) => `BODY:${body ?? "(none)"}`,
      }),
    );
    await tick();
    expect((lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "")).toContain("default body");
    stdin.write("!"); // edit the body
    await tick();
    stdin.write("\x04"); // Ctrl-D finishes
    await tick();
    unmount();
    expect(captured.md).toBe("BODY:default body!");
  });

  test("the prompt-body editor moves the cursor with arrows and inserts there", async () => {
    const UP = "\x1b[A";
    const LEFT = "\x1b[D";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    const captured: { md: string | null } = { md: null };
    const { stdin, unmount } = render(
      createElement(SetupWizard, {
        onComplete: (md: string) => {
          captured.md = md;
        },
        initialMode: "customized",
        onlyFields: ["promptBody"],
        initialBody: "abc\ndef", // cursor starts at the end (line 2, col 3)
        buildMarkdown: (_answers: unknown, body?: string) => `BODY:${body ?? "(none)"}`,
      }),
    );
    await tick();
    for (let i = 0; i < 3; i++) {
      stdin.write(LEFT); // to start of line 2
      await tick();
    }
    stdin.write(UP); // up to line 1, col 0 (start of "abc")
    await tick();
    stdin.write("X"); // insert at the very start
    await tick();
    stdin.write("\x04"); // Ctrl-D
    await tick();
    unmount();
    expect(captured.md).toBe("BODY:Xabc\ndef");
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
    // Strip ANSI styling — the bold label and the value sit in separate spans.
    const plain = frame.replace(/\[[0-9;]*m/g, "");
    expect(plain).toContain("customized · step 1");
    expect(plain).toContain("Project name"); // the title
    expect(plain).toContain("The project's display name"); // the description line
    expect(plain).toContain("svc"); // the prefilled value in the input
    unmount();
  });
});

describe("IndicatorBuilder", () => {
  test("builds a get-slot filter from chosen type + value", async () => {
    const ENTER = "\r";
    const DOWN = "[B";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    const captured: { map: IndicatorMap | null } = { map: null };
    const { stdin, unmount } = render(
      createElement(IndicatorBuilder, {
        slots: ["getTodo"],
        onDone: (m: IndicatorMap) => {
          captured.map = m;
        },
        onCancel: () => {},
      }),
    );
    await tick();
    stdin.write(ENTER); // type = status (first option)
    await tick();
    stdin.write("Todo"); // marker value
    await tick();
    stdin.write(ENTER); // add marker
    await tick();
    for (let i = 0; i < 5; i++) {
      stdin.write(DOWN); // move to "done with this slot"
      await tick();
    }
    stdin.write(ENTER); // finish slot -> last slot -> onDone
    await tick();
    unmount();
    expect(captured.map).toEqual({ getTodo: { filter: [{ type: "status", value: "Todo" }] } });
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

describe("RecreateOrExitPrompt", () => {
  test("offers recreate/exit and reports the chosen option", async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    let choice = "";
    const { stdin, lastFrame, unmount } = render(
      createElement(RecreateOrExitPrompt, { onChoice: (value: string) => (choice = value) }),
    );
    await tick();
    expect(lastFrame() ?? "").toContain("WORKFLOW.md is invalid");
    stdin.write("\r"); // first option = recreate
    await tick();
    unmount();
    expect(choice).toBe("recreate");
  });
});

describe("MigratePrompt", () => {
  test("shows the version delta + change descriptions and reports the choice", async () => {
    const DOWN = "\x1b[B";
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
    let choice = "";
    const { stdin, lastFrame, unmount } = render(
      createElement(MigratePrompt, {
        fromVersion: 0,
        toVersion: 1,
        descriptions: ["Added the confirmation gate and PR tracker."],
        onChoice: (value: string) => (choice = value),
      }),
    );
    await tick();
    const plain = (lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("out of date (v0 → v1)");
    expect(plain).toContain("Added the confirmation gate and PR tracker.");
    stdin.write(DOWN); // diff -> all
    await tick();
    stdin.write("\r");
    await tick();
    unmount();
    expect(choice).toBe("all");
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
