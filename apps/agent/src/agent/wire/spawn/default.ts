import { join } from "node:path";
import { initWorkerLog, logOutput, logSession } from "@ralphy/log";

/**
 * Default worker spawner: pipes stdout/stderr through a line-buffered
 * splitter that emits each line to `onWorkerOutput` (UI ring buffer) and
 * tees to `<logsDir>/<changeName>.log` so users have both a live tail
 * and a `tail -f`-able file. Tests inject `runners.spawnWorker` to skip
 * the streaming entirely.
 */
export function defaultSpawn(
  changeName: string,
  cmd: string[],
  cwd: string,
  logsDir: string,
  onWorkerOutput: ((changeName: string, line: string) => void) | undefined,
  note?: string,
): { exited: Promise<number>; kill: () => void; logFilePath: string } {
  const logFilePath = join(logsDir, `${changeName}.log`);
  const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;
  const BOX_ONLY_RE = /^[\s─│╭╮╰╯╌┄━┃]+$/;
  const STATUS_BAR_LINE_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗]\s+iter\s+\d+/;
  const ITER_HEADER_LINE_RE = /^──/;
  function isLogWorthy(clean: string): boolean {
    return (
      !BOX_ONLY_RE.test(clean) &&
      !STATUS_BAR_LINE_RE.test(clean) &&
      !ITER_HEADER_LINE_RE.test(clean)
    );
  }
  async function pump(stream: ReadableStream<Uint8Array> | null, label: string): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const clean = line.replace(ANSI_RE, "").trim();
          if (clean && isLogWorthy(clean)) logOutput(logFilePath, clean);
          if (line) onWorkerOutput?.(changeName, label === "err" ? `! ${line}` : line);
        }
      }
      if (buf) {
        const clean = buf.replace(ANSI_RE, "").trim();
        if (clean && isLogWorthy(clean)) logOutput(logFilePath, clean);
        onWorkerOutput?.(changeName, label === "err" ? `! ${buf}` : buf);
      }
    } catch {
      /* stream errors are non-fatal — exit drives control flow */
    }
  }
  const p = Bun.spawn({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  void initWorkerLog(logFilePath).then(() => {
    if (note) logSession(note, logFilePath);
  });
  void pump(p.stdout as ReadableStream<Uint8Array>, "out");
  void pump(p.stderr as ReadableStream<Uint8Array>, "err");
  return { exited: p.exited, kill: () => p.kill(), logFilePath };
}
