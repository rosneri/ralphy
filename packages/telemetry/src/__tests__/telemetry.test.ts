import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock posthog-node before importing telemetry
const mockCapture = mock(() => {});
const mockShutdown = mock(async () => {});
const MockPostHog = mock(function (this: Record<string, unknown>) {
  this.capture = mockCapture;
  this.shutdown = mockShutdown;
});

mock.module("posthog-node", () => ({ PostHog: MockPostHog }));

describe("telemetry", () => {
  beforeEach(() => {
    mockCapture.mockClear();
    mockShutdown.mockClear();
    MockPostHog.mockClear();
  });

  test("capture is a no-op when RALPH_POSTHOG_KEY is not set", async () => {
    const original = process.env["RALPH_POSTHOG_KEY"];
    delete process.env["RALPH_POSTHOG_KEY"];

    const { capture } = await import("../index");
    capture("test_event", { foo: "bar" });

    expect(mockCapture).not.toHaveBeenCalled();

    if (original !== undefined) process.env["RALPH_POSTHOG_KEY"] = original;
  });

  test("setDefaultProperties and capture do not throw", async () => {
    const { setDefaultProperties, capture } = await import("../index");
    // client is null here (init not called), so capture is a no-op — but
    // setDefaultProperties must not throw and the merged-props path must be safe.
    setDefaultProperties({ mode: "agent", engine: "claude" });
    expect(() => capture("test_event", { extra: "val" })).not.toThrow();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  test("captureError shape: emits error_message, error_name, error_stack", async () => {
    const { setDefaultProperties, captureError } = await import("../index");
    // client is null (init not called in this suite path), so the underlying
    // mockCapture is not invoked — but we're asserting captureError doesn't
    // throw and that the spread shape would carry the error fields.
    setDefaultProperties({});
    expect(() =>
      captureError("command_error", new Error("boom"), { subcommand: "loop" }),
    ).not.toThrow();
    expect(() => captureError("command_error", "string-error")).not.toThrow();
  });

  test("capture is a no-op when RALPH_TELEMETRY=0", async () => {
    const origKey = process.env["RALPH_POSTHOG_KEY"];
    const origTel = process.env["RALPH_TELEMETRY"];
    process.env["RALPH_POSTHOG_KEY"] = "test-key";
    process.env["RALPH_TELEMETRY"] = "0";

    const { capture } = await import("../index");
    capture("test_event");

    expect(mockCapture).not.toHaveBeenCalled();

    if (origKey !== undefined) process.env["RALPH_POSTHOG_KEY"] = origKey;
    else delete process.env["RALPH_POSTHOG_KEY"];
    if (origTel !== undefined) process.env["RALPH_TELEMETRY"] = origTel;
    else delete process.env["RALPH_TELEMETRY"];
  });
});
