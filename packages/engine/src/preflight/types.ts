export type PreflightTool = "gh" | "claude";

export type PreflightResult = { ok: true } | { ok: false; tool: PreflightTool; message: string };
