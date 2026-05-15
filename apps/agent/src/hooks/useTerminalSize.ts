import { useEffect, useState } from "react";

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

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => ({
    ...readSize(),
    resizeKey: 0,
  }));

  useEffect(() => {
    if (!process.stdout.isTTY) return;

    const onResize = () => {
      const { columns, rows } = readSize();
      setSize((prev) => {
        if (prev.columns === columns && prev.rows === rows) return prev;
        return { columns, rows, resizeKey: prev.resizeKey + 1 };
      });
    };

    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  return size;
}
