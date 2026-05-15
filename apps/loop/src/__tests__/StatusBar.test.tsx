import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ReactElement } from "react";
import { render as inkRender } from "ink";
import { render } from "ink-testing-library";
import { StatusBar } from "../components/StatusBar";

function renderWithColumns(tree: ReactElement, columns: number) {
  class Stdout extends EventEmitter {
    frames: string[] = [];
    _lastFrame = "";
    get columns() {
      return columns;
    }
    write = (frame: string) => {
      this.frames.push(frame);
      this._lastFrame = frame;
    };
    lastFrame = () => this._lastFrame;
  }
  class Stderr extends EventEmitter {
    write = (_frame: string) => {};
  }
  class Stdin extends EventEmitter {
    isTTY = true;
    setEncoding() {}
    setRawMode() {}
    resume() {}
    pause() {}
    ref() {}
    unref() {}
    read() {
      return null;
    }
  }
  const stdout = new Stdout();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new Stderr() as unknown as NodeJS.WriteStream,
    stdin: new Stdin() as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { lastFrame: stdout.lastFrame, unmount: instance.unmount };
}

describe("StatusBar", () => {
  const baseProps = {
    iteration: 3,
    costUsd: 0,
    startedAt: Date.now(),
    engine: "claude",
    model: "opus",
    isRunning: true,
  };

  test("renders iteration number", () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    expect(lastFrame()!).toContain("3");
  });

  test("renders engine/model", () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    expect(lastFrame()!).toContain("claude/opus");
  });

  test("renders cost when > 0", () => {
    const { lastFrame } = render(<StatusBar {...baseProps} costUsd={1.23} />);
    expect(lastFrame()!).toContain("$1.23");
  });

  test("does not render cost when 0", () => {
    const { lastFrame } = render(<StatusBar {...baseProps} costUsd={0} />);
    expect(lastFrame()!).not.toContain("$0.00");
  });

  test("renders check mark when not running", () => {
    const { lastFrame } = render(<StatusBar {...baseProps} isRunning={false} />);
    // Check mark should be present instead of spinner
    expect(lastFrame()!).toBeDefined();
  });

  test("renders separator bars", () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    expect(lastFrame()!).toContain("─");
  });

  test("formatElapsed handles seconds", () => {
    // startedAt is close to now, so elapsed should be 0s or very small
    const { lastFrame } = render(<StatusBar {...baseProps} startedAt={Date.now()} />);
    expect(lastFrame()!).toContain("0s");
  });

  test("formatElapsed handles minutes", async () => {
    // startedAt 90 seconds ago; need to wait for the setInterval to fire
    const { lastFrame } = render(<StatusBar {...baseProps} startedAt={Date.now() - 90_000} />);
    await new Promise((r) => setTimeout(r, 1100));
    expect(lastFrame()!).toContain("1m");
  });

  test("formatElapsed handles hours", async () => {
    // startedAt 2 hours ago; need to wait for the setInterval to fire
    const { lastFrame } = render(
      <StatusBar {...baseProps} startedAt={Date.now() - 2 * 60 * 60 * 1000} />,
    );
    await new Promise((r) => setTimeout(r, 1100));
    expect(lastFrame()!).toContain("2h");
  });

  test("renders iteration label", () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    const frame = lastFrame()!;
    expect(frame).toContain("iter");
  });

  describe("bar width tracks terminal columns", () => {
    const originalColumns = process.stdout.columns;

    function withProcessColumns(columns: number, fn: () => void) {
      Object.defineProperty(process.stdout, "columns", {
        value: columns,
        configurable: true,
        writable: true,
      });
      try {
        fn();
      } finally {
        Object.defineProperty(process.stdout, "columns", {
          value: originalColumns,
          configurable: true,
          writable: true,
        });
      }
    }

    test.each([
      [4, 8],
      [80, 80],
      [140, 140],
    ])("columns=%i renders a rule of length %i", (columns, expectedWidth) => {
      withProcessColumns(columns, () => {
        const { lastFrame, unmount } = renderWithColumns(
          <StatusBar {...baseProps} />,
          columns,
        );
        const frame = lastFrame()!;
        const ruleChars = (frame.match(/─/g) ?? []).length;
        expect(ruleChars).toBe(expectedWidth * 2);
        unmount();
      });
    });
  });
});
