export type PreflightTool = "gh" | "claude" | "repo" | "tokenade";

export type PreflightResult = { ok: true } | { ok: false; tool: PreflightTool; message: string };
