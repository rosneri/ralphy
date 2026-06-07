export type PreflightTool = "gh" | "claude" | "repo";

export type PreflightResult = { ok: true } | { ok: false; tool: PreflightTool; message: string };
