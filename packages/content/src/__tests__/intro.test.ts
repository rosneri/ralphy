import { describe, it, expect } from "bun:test";
import { getStarterPackIntro } from "../intro";

describe("getStarterPackIntro", () => {
  it("returns non-empty title, world, and story fields", () => {
    const intro = getStarterPackIntro();
    expect(intro.title.length).toBeGreaterThan(0);
    expect(intro.world.length).toBeGreaterThan(0);
    expect(intro.story.length).toBeGreaterThan(0);
  });

  it("returns strings for all fields", () => {
    const intro = getStarterPackIntro();
    expect(typeof intro.title).toBe("string");
    expect(typeof intro.world).toBe("string");
    expect(typeof intro.story).toBe("string");
  });
});
