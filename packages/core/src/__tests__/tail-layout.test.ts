import { describe, expect, test } from "bun:test";
import {
  computeFocusedTailLayout,
  MIN_TAIL_LINES,
  type TailLayoutInput,
} from "../agent-mode/tail-layout";

const baseInput: TailLayoutInput = {
  termHeight: 50,
  activeCount: 1,
  steeringActive: false,
  hasPauseBanner: false,
  hasCurrentTask: false,
  hasCmd: false,
  hasPhasePipeline: false,
  subtasksPanel: { visible: false, rendered: 0 },
  hasProgressBar: false,
};

// Baseline overhead (activeCount=1, no extras): header(5) + poll(7) + chrome(8) = 20.
const BASE_OVERHEAD = 20;

describe("computeFocusedTailLayout", () => {
  test("tall body + short terminal hides OUTPUT", () => {
    const r = computeFocusedTailLayout({
      ...baseInput,
      termHeight: 22,
      steeringActive: true,
      hasCurrentTask: true,
      hasCmd: true,
      hasPhasePipeline: true,
      subtasksPanel: { visible: true, rendered: 10 },
      hasProgressBar: true,
    });
    expect(r.showOutputTail).toBe(false);
    expect(r.focusedTailLines).toBe(0);
  });

  test("ample terminal returns expected row budget", () => {
    const r = computeFocusedTailLayout({ ...baseInput, termHeight: 50 });
    expect(r.focusedTailLines).toBe(50 - BASE_OVERHEAD);
    expect(r.showOutputTail).toBe(true);
  });

  test("subtasks panel toggle flips visibility at boundary height", () => {
    // With panel hidden, overhead=20, need termHeight=20+MIN_TAIL_LINES=23.
    const closed = computeFocusedTailLayout({ ...baseInput, termHeight: 23 });
    expect(closed.showOutputTail).toBe(true);
    expect(closed.focusedTailLines).toBe(MIN_TAIL_LINES);

    // Opening subtasks panel adds 1(header)+5(rows) = 6 → overhead=26 > 23.
    const open = computeFocusedTailLayout({
      ...baseInput,
      termHeight: 23,
      subtasksPanel: { visible: true, rendered: 5 },
    });
    expect(open.showOutputTail).toBe(false);
    expect(open.focusedTailLines).toBe(0);
  });

  test("steering active adds 3 rows of overhead", () => {
    const off = computeFocusedTailLayout({ ...baseInput, termHeight: 40 });
    const on = computeFocusedTailLayout({ ...baseInput, termHeight: 40, steeringActive: true });
    expect(off.focusedTailLines - on.focusedTailLines).toBe(3);
  });

  test("sibling workers each cost 4 rows", () => {
    const one = computeFocusedTailLayout({ ...baseInput, termHeight: 80, activeCount: 1 });
    const two = computeFocusedTailLayout({ ...baseInput, termHeight: 80, activeCount: 2 });
    const three = computeFocusedTailLayout({ ...baseInput, termHeight: 80, activeCount: 3 });
    // activeCount>1 also adds the tasks box (5 rows). Sibling cost is 4 per extra worker.
    expect(one.focusedTailLines - two.focusedTailLines).toBe(5 + 4);
    expect(two.focusedTailLines - three.focusedTailLines).toBe(4);
  });

  test("termHeight === 0 clamps to hidden", () => {
    const r = computeFocusedTailLayout({ ...baseInput, termHeight: 0 });
    expect(r.focusedTailLines).toBe(0);
    expect(r.showOutputTail).toBe(false);
  });
});
