import { describe, expect, test } from "bun:test";
import { createBus } from "../bus";
import { subscribePostHog } from "../consumers/posthog";

describe("subscribePostHog — loop.* alias forwarding", () => {
  function setup() {
    const bus = createBus();
    const captured: Array<{ name: string; props: Record<string, unknown> }> = [];
    const unsub = subscribePostHog(bus, (name, props) => {
      captured.push({ name, props: props ?? {} });
    });
    return { bus, captured, unsub };
  }

  test("loop.task_started forwards as task_started with payload", () => {
    const { bus, captured } = setup();
    bus.emit({
      type: "loop.task_started",
      engine: "claude",
      model: "opus",
      is_resume: false,
      has_prompt: true,
      max_iterations: 10,
      max_cost_usd: 5,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe("task_started");
    expect(captured[0].props).toMatchObject({
      engine: "claude",
      model: "opus",
      is_resume: false,
      has_prompt: true,
      max_iterations: 10,
      max_cost_usd: 5,
    });
  });

  test("loop.engine_rate_limited forwards as engine_rate_limited", () => {
    const { bus, captured } = setup();
    bus.emit({ type: "loop.engine_rate_limited", exit_code: 429, iteration: 3 });
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe("engine_rate_limited");
    expect(captured[0].props).toMatchObject({ exit_code: 429, iteration: 3 });
  });

  test("loop.iteration_failed forwards as iteration_failed", () => {
    const { bus, captured } = setup();
    bus.emit({
      type: "loop.iteration_failed",
      exit_code: 1,
      iteration: 2,
      consecutive_failures: 1,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe("iteration_failed");
    expect(captured[0].props).toMatchObject({
      exit_code: 1,
      iteration: 2,
      consecutive_failures: 1,
    });
  });

  test("loop.engine_error forwards as engine_error", () => {
    const { bus, captured } = setup();
    bus.emit({ type: "loop.engine_error", iteration: 5, error: "boom" });
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe("engine_error");
    expect(captured[0].props).toMatchObject({ iteration: 5, error: "boom" });
  });

  test("loop.task_stopped forwards as task_stopped", () => {
    const { bus, captured } = setup();
    bus.emit({
      type: "loop.task_stopped",
      stop_reason: "completed",
      iterations: 7,
      total_cost_usd: 1.23,
      total_duration_ms: 4567,
      engine: "claude",
      model: "opus",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe("task_stopped");
    expect(captured[0].props).toMatchObject({
      stop_reason: "completed",
      iterations: 7,
      engine: "claude",
      model: "opus",
    });
  });
});
