import { basename } from "node:path";

const decoder = new TextDecoder();

interface TmuxSessionStatus {
  exists: boolean;
  attached: boolean;
  name: string;
}

export function tmuxAvailable(): boolean {
  const result = Bun.spawnSync({ cmd: ["tmux", "-V"], stderr: "pipe" });
  return result.exitCode === 0;
}

export function sessionName(projectRoot: string): string {
  const override = process.env["RALPH_SESSION_NAME"];
  if (override) return override;
  return `ralphy-agent-${basename(projectRoot)}`;
}

export function sessionExists(name: string): boolean {
  const result = Bun.spawnSync({ cmd: ["tmux", "has-session", "-t", name], stderr: "pipe" });
  return result.exitCode === 0;
}

export function isInsideTmux(): boolean {
  return !!process.env["TMUX"];
}

export function getSessionStatus(name: string): TmuxSessionStatus {
  const result = Bun.spawnSync({
    cmd: ["tmux", "list-sessions", "-F", "#{session_name} #{session_attached}"],
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    return { exists: false, attached: false, name };
  }

  const output = decoder.decode(result.stdout);
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.lastIndexOf(" ");
    if (spaceIdx < 0) continue;
    const sName = trimmed.slice(0, spaceIdx);
    const attachedCount = parseInt(trimmed.slice(spaceIdx + 1), 10);
    if (sName === name) {
      return { exists: true, attached: attachedCount > 0, name };
    }
  }

  return { exists: false, attached: false, name };
}

export function createSession(name: string, command: string[], env: Record<string, string>): void {
  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    envArgs.push("-e", `${key}=${value}`);
  }

  // Always pause after exit so the user can read the output before the pane closes.
  const quoted = command.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const shellCmd = `${quoted}; printf '\\n[ralphy exited — press Enter to close]\\n'; read`;

  const result = Bun.spawnSync({
    cmd: ["tmux", "new-session", "-d", "-s", name, ...envArgs, "sh", "-c", shellCmd],
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = decoder.decode(result.stderr);
    if (!stderr.includes("duplicate session")) {
      const err = new Error("tmux new-session failed") as Error & { stderr?: string };
      err.stderr = stderr.trim();
      throw err;
    }
  }
}

export function attachSession(name: string): void {
  Bun.spawnSync({
    cmd: ["tmux", "attach-session", "-t", name],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

export function switchClientToSession(name: string): void {
  Bun.spawnSync({
    cmd: ["tmux", "switch-client", "-t", name],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

export function killSession(name: string): boolean {
  const result = Bun.spawnSync({ cmd: ["tmux", "kill-session", "-t", name], stderr: "pipe" });
  return result.exitCode === 0;
}
