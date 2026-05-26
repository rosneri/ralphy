import { useEffect, useRef, useState } from "react";

export interface TerminalSize {
  columns: number;
  rows: number;
  resizeKey: number;
}

function readSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

/**
 * Clear the visible screen, the scrollback buffer, and move the cursor home.
 * Performed synchronously in the resize handler — BEFORE setSize triggers a
 * React re-render — so that when consumers use `key={resizeKey}` to remount
 * an `<ink/Static>` and re-emit its accumulated items, those items land on a
 * freshly cleared terminal instead of being wiped by a later effect. (Earlier
 * we cleared in a useEffect, which ran AFTER Static re-printed and silently
 * erased the log history on every resize — see RLF-57.)
 */
function clearScreenAndScrollback(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

export function useTerminalSize(): TerminalSize {
  const initial = useRef<TerminalSize>({ ...readSize(), resizeKey: 0 });
  const [size, setSize] = useState<TerminalSize>(initial.current);
  const sizeRef = useRef<TerminalSize>(initial.current);

  useEffect(() => {
    if (!process.stdout.isTTY) return;

    const onResize = () => {
      const { columns, rows } = readSize();
      const prev = sizeRef.current;
      if (prev.columns === columns && prev.rows === rows) return;
      clearScreenAndScrollback();
      const next: TerminalSize = { columns, rows, resizeKey: prev.resizeKey + 1 };
      sizeRef.current = next;
      setSize(next);
    };

    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  return size;
}
