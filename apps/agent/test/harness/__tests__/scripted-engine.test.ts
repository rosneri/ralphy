import { describe, expect, test } from "bun:test";
import { createScriptedEngine } from "../scripted-engine";

describe("createScriptedEngine", () => {
  test("yields steps in order (happy path)", async () => {
    const e = createScriptedEngine({
      scenario: [
        { kind: "message", payload: "hi" },
        { kind: "diff", payload: "+++ b/foo" },
        { kind: "exit", payload: { code: 0 } },
      ],
    });
    expect((await e.next()).kind).toBe("message");
    expect((await e.next()).kind).toBe("diff");
    expect((await e.next()).kind).toBe("exit");
    expect(e.remaining()).toBe(0);
  });

  test("throws on transcript exhaustion", async () => {
    const e = createScriptedEngine({ scenario: [{ kind: "exit", payload: { code: 0 } }] });
    await e.next();
    await expect(e.next()).rejects.toThrow(/exhausted/);
  });

  test("throws on unscripted call (zero-length transcript)", async () => {
    const e = createScriptedEngine({ scenario: [] });
    await expect(e.next()).rejects.toThrow(/exhausted/);
  });
});
