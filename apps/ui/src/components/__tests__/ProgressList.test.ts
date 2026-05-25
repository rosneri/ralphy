import { describe, expect, test } from "bun:test";
import { toggleSection } from "../ProgressList";

describe("ProgressList toggleSection", () => {
  test("sections start collapsed (empty expanded set)", () => {
    const initial = new Set<string>();
    expect(initial.has("Planning")).toBe(false);
    expect(initial.has("Implementation")).toBe(false);
  });

  test("toggling a collapsed section expands it", () => {
    const initial = new Set<string>();
    const next = toggleSection(initial, "Planning");
    expect(next.has("Planning")).toBe(true);
    expect(initial.has("Planning")).toBe(false);
  });

  test("toggling an expanded section collapses it again", () => {
    const expanded = toggleSection(new Set<string>(), "Planning");
    const collapsed = toggleSection(expanded, "Planning");
    expect(collapsed.has("Planning")).toBe(false);
  });

  test("toggling one section does not affect others", () => {
    let state: ReadonlySet<string> = new Set<string>();
    state = toggleSection(state, "Planning");
    state = toggleSection(state, "Implementation");
    expect(state.has("Planning")).toBe(true);
    expect(state.has("Implementation")).toBe(true);
    state = toggleSection(state, "Planning");
    expect(state.has("Planning")).toBe(false);
    expect(state.has("Implementation")).toBe(true);
  });
});
