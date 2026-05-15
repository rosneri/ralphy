import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useTerminalSize, type TerminalSize } from "../useTerminalSize";

type StdoutMutable = {
  columns: number;
  rows: number;
  isTTY: boolean;
};

function mutStdout(): StdoutMutable {
  return process.stdout as unknown as StdoutMutable;
}

function HookProbe({ onRender }: { onRender: (s: TerminalSize) => void }) {
  const size = useTerminalSize();
  onRender(size);
  return React.createElement(Text, null, `${size.columns}x${size.rows}`);
}

function captureLatest() {
  let latest: TerminalSize | null = null;
  const onRender = (s: TerminalSize) => {
    latest = s;
  };
  return {
    onRender,
    get value(): TerminalSize {
      if (!latest) throw new Error("hook never rendered");
      return latest;
    },
  };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("useTerminalSize", () => {
  let originalColumns: number;
  let originalRows: number;
  let originalIsTTY: boolean;

  beforeEach(() => {
    const s = mutStdout();
    originalColumns = s.columns;
    originalRows = s.rows;
    originalIsTTY = s.isTTY;
    s.columns = 100;
    s.rows = 40;
    s.isTTY = true;
  });

  afterEach(() => {
    const s = mutStdout();
    s.columns = originalColumns;
    s.rows = originalRows;
    s.isTTY = originalIsTTY;
    process.stdout.removeAllListeners("resize");
  });

  test("returns initial size from process.stdout", () => {
    const probe = captureLatest();
    const { unmount } = render(React.createElement(HookProbe, { onRender: probe.onRender }));
    expect(probe.value.columns).toBe(100);
    expect(probe.value.rows).toBe(40);
    expect(probe.value.resizeKey).toBe(0);
    unmount();
  });

  test("attaches listener on mount and removes on unmount", async () => {
    const before = process.stdout.listenerCount("resize");
    const probe = captureLatest();
    const { unmount } = render(React.createElement(HookProbe, { onRender: probe.onRender }));
    await flush();
    expect(process.stdout.listenerCount("resize")).toBe(before + 1);
    unmount();
    await flush();
    expect(process.stdout.listenerCount("resize")).toBe(before);
  });

  test("updates state when stdout emits 'resize'", async () => {
    const probe = captureLatest();
    const { unmount } = render(React.createElement(HookProbe, { onRender: probe.onRender }));
    await flush();
    const s = mutStdout();
    s.columns = 120;
    s.rows = 50;
    process.stdout.emit("resize");
    await flush();
    expect(probe.value.columns).toBe(120);
    expect(probe.value.rows).toBe(50);
    expect(probe.value.resizeKey).toBe(1);
    unmount();
  });

  test("no-op resize does not bump resizeKey", async () => {
    const probe = captureLatest();
    const { unmount } = render(React.createElement(HookProbe, { onRender: probe.onRender }));
    process.stdout.emit("resize");
    await flush();
    expect(probe.value.resizeKey).toBe(0);
    unmount();
  });

  test("skips listening when stdout is not a TTY", () => {
    const s = mutStdout();
    s.isTTY = false;
    const before = process.stdout.listenerCount("resize");
    const probe = captureLatest();
    const { unmount } = render(React.createElement(HookProbe, { onRender: probe.onRender }));
    expect(process.stdout.listenerCount("resize")).toBe(before);
    unmount();
  });
});
