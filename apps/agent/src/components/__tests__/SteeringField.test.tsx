import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SteeringField } from "../SteeringField";

const CTRL_S = "\x13"; // Ctrl+S = SOH (0x13)
const ESC = "\x1b";
const ENTER = "\r";
const BACKSPACE = "\x7f";

async function flush() {
  await new Promise((r) => setTimeout(r, 50));
}

describe("SteeringField", () => {
  test("starts idle with placeholder", () => {
    const { lastFrame, unmount } = render(
      React.createElement(SteeringField, {
        active: true,
        width: 60,
        onSubmit: () => {},
      }),
    );
    expect(lastFrame()).toContain("CTRL+S to steer");
    unmount();
  });

  test("hidden when inactive", () => {
    const { lastFrame, unmount } = render(
      React.createElement(SteeringField, {
        active: false,
        width: 60,
        onSubmit: () => {},
      }),
    );
    expect(lastFrame() ?? "").not.toContain("CTRL+S to steer");
    unmount();
  });

  test("Ctrl+S focuses; printable chars build the buffer", async () => {
    const { stdin, lastFrame, unmount } = render(
      React.createElement(SteeringField, {
        active: true,
        width: 60,
        onSubmit: () => {},
      }),
    );
    await flush();
    stdin.write(CTRL_S);
    await flush();
    stdin.write("hello");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("hello");
    expect(frame).not.toContain("CTRL+S to steer");
    unmount();
  });

  test("Esc clears the buffer and blurs", async () => {
    const { stdin, lastFrame, unmount } = render(
      React.createElement(SteeringField, {
        active: true,
        width: 60,
        onSubmit: () => {},
      }),
    );
    await flush();
    stdin.write(CTRL_S);
    await flush();
    stdin.write("draft");
    await flush();
    stdin.write(ESC);
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("CTRL+S to steer");
    expect(frame).not.toContain("draft");
    unmount();
  });

  test("Enter submits the trimmed buffer and clears it", async () => {
    const calls: string[] = [];
    const { stdin, lastFrame, unmount } = render(
      React.createElement(SteeringField, {
        active: true,
        width: 60,
        onSubmit: (m: string) => {
          calls.push(m);
        },
      }),
    );
    await flush();
    stdin.write(CTRL_S);
    await flush();
    stdin.write("  please prefer Bun APIs  ");
    await flush();
    stdin.write(ENTER);
    await flush();
    expect(calls).toEqual(["please prefer Bun APIs"]);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("please prefer Bun APIs");
    unmount();
  });

  test("empty buffer + Enter does not call onSubmit", async () => {
    const calls: string[] = [];
    const { stdin, unmount } = render(
      React.createElement(SteeringField, {
        active: true,
        width: 60,
        onSubmit: (m: string) => {
          calls.push(m);
        },
      }),
    );
    await flush();
    stdin.write(CTRL_S);
    await flush();
    stdin.write("   ");
    await flush();
    stdin.write(ENTER);
    await flush();
    expect(calls).toEqual([]);
    unmount();
  });

  test("Backspace deletes the char before the cursor", async () => {
    const { stdin, lastFrame, unmount } = render(
      React.createElement(SteeringField, {
        active: true,
        width: 60,
        onSubmit: () => {},
      }),
    );
    await flush();
    stdin.write(CTRL_S);
    await flush();
    stdin.write("abcd");
    await flush();
    stdin.write(BACKSPACE);
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("abc");
    expect(frame).not.toMatch(/abcd[^e]/);
    unmount();
  });
});
