import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildTaskPrompt,
  checkStopSignal,
  checkStopCondition,
  updateStateIteration,
  appendSteeringMessage,
  buildSteeringPrompt,
  mergeUsage,
} from "../loop";
import {
  firstUnchecked as extractFirstUncheckedSection,
  allCompleted as allTasksCompleted,
  countUnchecked as countUncheckedTasks,
} from "../tasks-md";
import { buildInitialState, writeState, readState } from "../state";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import type { State } from "@ralphy/types";

let tempDir: string;
const withStorage = <T>(fn: () => T): T => runWithContext(createDefaultContext(), fn);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "core-loop-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeState(): State {
  return buildInitialState({ name: "demo-change", prompt: "Demo prompt" });
}

describe("buildTaskPrompt", () => {
  test("includes steering content from steering.md when present", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(
        join(tempDir, "steering.md"),
        "Follow convention X\nAvoid pattern Y\n",
        "utf-8",
      );

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("User Steering");
      expect(prompt).toContain("Follow convention X");
      expect(prompt).toContain("Avoid pattern Y");
    }));

  test("includes first unchecked task section from tasks.md", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(
        join(tempDir, "tasks.md"),
        [
          "## 1. Setup",
          "- [x] Done item",
          "",
          "## 2. Implementation",
          "- [ ] Write code",
          "- [ ] Add tests",
          "",
          "## 3. Finish",
          "- [ ] Wrap up",
        ].join("\n"),
        "utf-8",
      );

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Current Task Section");
      expect(prompt).toContain("## 2. Implementation");
      expect(prompt).toContain("Write code");
      expect(prompt).not.toContain("## 3. Finish");
    }));

  test("omits steering block when steering.md is absent", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("User Steering");
    }));

  test("prioritizes agent-tasks.md over tasks.md when it has unchecked items", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "tasks.md"), "## Implementation\n- [ ] mission work\n", "utf-8");
      writeFileSync(
        join(tempDir, "agent-tasks.md"),
        "## Fix failing CI checks\n- [ ] resolve the failing test\n",
        "utf-8",
      );

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("## Fix failing CI checks");
      expect(prompt).toContain("resolve the failing test");
      expect(prompt).not.toContain("mission work");
      expect(prompt).toContain("agent-tasks.md");
    }));

  test("falls back to tasks.md when agent-tasks.md is fully checked", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "tasks.md"), "## Implementation\n- [ ] mission work\n", "utf-8");
      writeFileSync(
        join(tempDir, "agent-tasks.md"),
        "## Fix failing CI checks\n- [x] resolved\n",
        "utf-8",
      );

      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("mission work");
      expect(prompt).not.toContain("Fix failing CI checks");
      expect(prompt).toContain(join(tempDir, "tasks.md"));
    }));
});

describe("allTasksCompleted", () => {
  test("returns true when all items are checked", () => {
    expect(allTasksCompleted("## A\n- [x] done\n- [x] also done\n")).toBe(true);
  });

  test("returns false when any item is unchecked", () => {
    expect(allTasksCompleted("## A\n- [x] done\n- [ ] pending\n")).toBe(false);
  });
});

describe("checkStopSignal", () => {
  test("returns null when STOP file is absent", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      expect(checkStopSignal(tempDir, tempDir)).toBeNull();
    }));

  test("returns reason, removes file, and marks state blocked", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "STOP"), "user-requested halt", "utf-8");

      const reason = checkStopSignal(tempDir, tempDir);
      expect(reason).toBe("user-requested halt");

      const persisted = readState(tempDir);
      expect(persisted.status).toBe("blocked");
    }));
});

describe("checkStopCondition", () => {
  const baseOptions = {
    name: "x",
    prompt: "",
    engine: "claude",
    model: "opus",
    maxIterations: 0,
    maxCostUsd: 0,
    maxRuntimeMinutes: 0,
    maxConsecutiveFailures: 0,
    delay: 0,
    log: false,
    verbose: false,
    manualTest: false,
    statesDir: "",
    tasksDir: "",
    changeStore: { archiveChange: async () => {} },
  };

  test("returns null when loop should continue", () => {
    const state = makeState();
    expect(checkStopCondition(state, 0, baseOptions, Date.now(), 0)).toBeNull();
  });

  test("returns maxIterations when iteration cap reached", () => {
    const state = makeState();
    expect(checkStopCondition(state, 5, { ...baseOptions, maxIterations: 5 }, Date.now(), 0)).toBe(
      "maxIterations",
    );
  });

  test("returns completed when state is not active", () => {
    const state = { ...makeState(), status: "completed" as const };
    expect(checkStopCondition(state, 0, baseOptions, Date.now(), 0)).toBe("completed");
  });

  test("returns costCap when usage exceeds maxCostUsd", () => {
    const state = makeState();
    state.usage.total_cost_usd = 5;
    expect(checkStopCondition(state, 0, { ...baseOptions, maxCostUsd: 1 }, Date.now(), 0)).toBe(
      "costCap",
    );
  });

  test("returns runtimeLimit when elapsed exceeds maxRuntimeMinutes", () => {
    const state = makeState();
    expect(
      checkStopCondition(
        state,
        0,
        { ...baseOptions, maxRuntimeMinutes: 1 },
        Date.now() - 120_000,
        0,
      ),
    ).toBe("runtimeLimit");
  });

  test("returns consecutiveFailures when failure threshold reached", () => {
    const state = makeState();
    expect(
      checkStopCondition(state, 0, { ...baseOptions, maxConsecutiveFailures: 3 }, Date.now(), 3),
    ).toBe("consecutiveFailures");
  });
});

describe("updateStateIteration", () => {
  test("increments iteration and appends history without usage", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      const updated = updateStateIteration(
        tempDir,
        "ok",
        "2026-01-01T00:00:00Z",
        "claude",
        "opus",
        null,
      );
      expect(updated.iteration).toBe(1);
      expect(updated.history).toHaveLength(1);
      expect(updated.history[0]!.result).toBe("ok");
      expect(updated.history[0]!.usage).toBeUndefined();
    }));

  test("accumulates usage totals when usage reported", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      const usage = {
        cost_usd: 0.5,
        duration_ms: 1000,
        num_turns: 2,
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      };
      const updated = updateStateIteration(
        tempDir,
        "ok",
        "2026-01-01T00:00:00Z",
        "claude",
        "opus",
        usage,
      );
      expect(updated.usage.total_cost_usd).toBe(0.5);
      expect(updated.usage.total_input_tokens).toBe(100);
      expect(updated.history[0]!.usage).toBeDefined();
    }));
});

describe("appendSteeringMessage", () => {
  test("creates steering.md when missing", () =>
    withStorage(() => {
      appendSteeringMessage(tempDir, "First message");
      const content = readFileSync(join(tempDir, "steering.md"), "utf-8");
      expect(content).toContain("First message");
    }));

  test("prepends to existing steering.md", () =>
    withStorage(() => {
      writeFileSync(join(tempDir, "steering.md"), "Old content\n", "utf-8");
      appendSteeringMessage(tempDir, "New message");
      const content = readFileSync(join(tempDir, "steering.md"), "utf-8");
      expect(content.indexOf("New message")).toBeLessThan(content.indexOf("Old content"));
    }));
});

describe("buildSteeringPrompt", () => {
  test("wraps message with live-steering framing", () => {
    const prompt = buildSteeringPrompt("do X");
    expect(prompt).toContain("LIVE STEERING UPDATE FROM USER:");
    expect(prompt).toContain("do X");
    expect(prompt).toContain("Continue your current task");
  });
});

describe("mergeUsage", () => {
  const usage = (cost: number) => ({
    cost_usd: cost,
    duration_ms: 100,
    num_turns: 1,
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 1,
    cache_creation_input_tokens: 1,
  });

  test("returns null when both are null", () => {
    expect(mergeUsage(null, null)).toBeNull();
  });

  test("returns the non-null side when only one is provided", () => {
    expect(mergeUsage(null, usage(1))).toEqual(usage(1));
    expect(mergeUsage(usage(2), null)).toEqual(usage(2));
  });

  test("sums fields when both are provided", () => {
    const merged = mergeUsage(usage(1), usage(2));
    expect(merged!.cost_usd).toBe(3);
    expect(merged!.duration_ms).toBe(200);
    expect(merged!.num_turns).toBe(2);
  });
});

describe("extractFirstUncheckedSection", () => {
  test("returns null when every section is fully checked", () => {
    const content = "## Alpha\n- [x] one\n\n## Beta\n- [x] two\n";
    expect(extractFirstUncheckedSection(content)).toBeNull();
  });

  test("returns the first section containing an unchecked item", () => {
    const content = "## Alpha\n- [x] one\n\n## Beta\n- [ ] two\n\n## Gamma\n- [ ] three\n";
    const section = extractFirstUncheckedSection(content);
    expect(section).not.toBeNull();
    expect(section).toContain("## Beta");
    expect(section).not.toContain("## Gamma");
  });

  test("falls back to whole file when no `## ` heading exists", () => {
    const content = "# Tasks\n\n- [ ] one\n- [x] two\n";
    const section = extractFirstUncheckedSection(content);
    expect(section).not.toBeNull();
    expect(section).toContain("- [ ] one");
  });
});

describe("countUncheckedTasks", () => {
  test("counts top-level unchecked items only", () => {
    expect(countUncheckedTasks("- [ ] a\n- [x] b\n- [ ] c\n")).toBe(2);
  });

  test("returns 0 when nothing is unchecked", () => {
    expect(countUncheckedTasks("- [x] done\n")).toBe(0);
  });
});

describe("buildTaskPrompt — auto verbosity (first 5 moments)", () => {
  test("injects very-short verbosity block on moment 1 (iteration 0)", () =>
    withStorage(() => {
      const state = makeState(); // iteration defaults to 0
      writeState(tempDir, state);
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Verbosity: VERY SHORT");
      expect(prompt).toContain("Moment 1/5");
      expect(prompt).toContain("warm-up moment 1 of 5");
    }));

  test("injects verbosity block on moment 5 (iteration 4)", () =>
    withStorage(() => {
      const state = { ...makeState(), iteration: 4 };
      writeState(tempDir, state);
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Verbosity: VERY SHORT");
      expect(prompt).toContain("Moment 5/5");
    }));

  test("omits verbosity block on moment 6 (iteration 5)", () =>
    withStorage(() => {
      const state = { ...makeState(), iteration: 5 };
      writeState(tempDir, state);
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("Verbosity: VERY SHORT");
    }));

  test("verbosity block appears before steering content", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "steering.md"), "Follow convention X\n", "utf-8");
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt.indexOf("Verbosity: VERY SHORT")).toBeLessThan(
        prompt.indexOf("Follow convention X"),
      );
    }));
});

describe("buildTaskPrompt — tracking instruction", () => {
  test("instructs the agent to tick boxes when an unchecked section is included", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "tasks.md"), "## Subtasks\n- [ ] do thing\n", "utf-8");
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Tracking progress");
      expect(prompt).toContain("- [x]");
      expect(prompt).toContain(join(tempDir, "tasks.md"));
    }));
});

describe("buildTaskPrompt — manual testing phase", () => {
  test("appends manual testing block when manualTest enabled and no unchecked tasks remain", () =>
    withStorage(() => {
      const state = { ...makeState(), manualTest: true };
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "tasks.md"), "## Done\n- [x] all done\n", "utf-8");
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("Manual Testing Phase");
      expect(prompt).toContain("Identify critical manual test scenarios");
    }));

  test("omits manual testing block when ## Manual Testing section already exists", () =>
    withStorage(() => {
      const state = { ...makeState(), manualTest: true };
      writeState(tempDir, state);
      writeFileSync(
        join(tempDir, "tasks.md"),
        "## Done\n- [x] all done\n\n## Manual Testing\n- [x] verified\n",
        "utf-8",
      );
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("Manual Testing Phase");
    }));

  test("omits manual testing block when unchecked tasks remain", () =>
    withStorage(() => {
      const state = { ...makeState(), manualTest: true };
      writeState(tempDir, state);
      writeFileSync(join(tempDir, "tasks.md"), "## Todo\n- [ ] not done\n", "utf-8");
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("Manual Testing Phase");
    }));
});

describe("buildTaskPrompt — createPr instructions", () => {
  test("appends PR creation instructions when createPr is enabled", () =>
    withStorage(() => {
      const state = { ...makeState(), createPr: true };
      writeState(tempDir, state);
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).toContain("git push -u origin HEAD");
      expect(prompt).toContain("gh pr create");
      expect(prompt).toContain(state.name);
    }));

  test("omits PR instructions when createPr is not set", () =>
    withStorage(() => {
      const state = makeState();
      writeState(tempDir, state);
      const prompt = buildTaskPrompt(state, tempDir);
      expect(prompt).not.toContain("gh pr create");
    }));
});
