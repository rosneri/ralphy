import { join, dirname } from "node:path";
import { exists } from "node:fs/promises";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { taskRoutes } from "./routes/tasks";
import { loopRoutes } from "./routes/loop";
import { documentRoutes } from "./routes/documents";
import { introRoutes } from "./routes/intro";
import { addStream, removeStream } from "./streams";
import { isTaskRunning } from "./routes/loop";
import type { SidecarContext } from "./types";

// Use SIDECAR_PORT env var, or 0 to let the OS assign a free port
const port = Number(process.env["SIDECAR_PORT"] ?? 0);

// Walk up from cwd to find the project root (directory containing openspec/)
async function findProjectRoot(start: string): Promise<string> {
  let dir = start;
  while (true) {
    if (await exists(join(dir, "openspec"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start; // fallback to cwd
}

const projectRoot = await findProjectRoot(process.cwd());
const openspecDir = join(projectRoot, "openspec");
const tasksDir = join(openspecDir, "changes");
const statesDir = join(projectRoot, ".ralph", "tasks");

const ctx: SidecarContext = { tasksDir, statesDir, ralphDir: openspecDir, projectRoot };

interface WsData {
  taskName: string;
}

type Route =
  | { handler: "tasks"; action: string; name: string | undefined }
  | { handler: "documents"; name: string; doc: string }
  | { handler: "loop"; name: string; action: string }
  | { handler: "intro" };

function parseRoute(pathname: string): Route | null {
  if (pathname === "/intro") return { handler: "intro" };

  // GET /tasks or POST /tasks
  if (pathname === "/tasks") return { handler: "tasks", action: "list", name: undefined };

  const parts = pathname.split("/").filter(Boolean);

  // /tasks/:name/document/:doc
  if (parts.length === 4 && parts[0] === "tasks" && parts[2] === "document") {
    return { handler: "documents", name: parts[1]!, doc: parts[3]! };
  }

  // /tasks/:name/start or /tasks/:name/stop or /tasks/:name/steer
  if (
    parts.length === 3 &&
    parts[0] === "tasks" &&
    (parts[2] === "start" || parts[2] === "stop" || parts[2] === "steer")
  ) {
    return { handler: "loop", name: parts[1]!, action: parts[2]! };
  }

  // /tasks/:name/delete
  if (parts.length === 3 && parts[0] === "tasks" && parts[2] === "delete") {
    return { handler: "tasks", action: parts[2]!, name: parts[1]! };
  }

  // /tasks/:name
  if (parts.length === 2 && parts[0] === "tasks") {
    return { handler: "tasks", action: "get", name: parts[1]! };
  }

  return null;
}

const server = Bun.serve<WsData>({
  port,
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for streaming
    if (url.pathname.startsWith("/tasks/") && url.pathname.endsWith("/stream")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const taskName = parts[1];
      if (taskName && server.upgrade(req, { data: { taskName } })) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // CORS headers for dev
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const route = parseRoute(url.pathname);
    if (!route) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
    }

    try {
      const result = await runWithContext(createDefaultContext(), async () => {
        switch (route.handler) {
          case "intro":
            return introRoutes(req);
          case "tasks":
            return taskRoutes(req, route, ctx);
          case "documents":
            return documentRoutes(req, route, ctx);
          case "loop":
            return loopRoutes(req, route, ctx);
          default:
            return { status: 404, body: { error: "Not found" } };
        }
      });

      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
    }
  },
  websocket: {
    async open(ws) {
      addStream(ws.data.taskName, ws);
      // Replay existing log entries so the feed persists across page reloads
      const logFile = join(tasksDir, ws.data.taskName, "LOG.jsonl");
      try {
        const file = Bun.file(logFile);
        if (await file.exists()) {
          const content = await file.text();
          for (const line of content.split("\n")) {
            if (line) ws.send(line);
          }
        }
      } catch {
        // Non-fatal: if log read fails, just skip replay
      }
      // Send current running status so reconnecting clients restore state
      if (isTaskRunning(ws.data.taskName)) {
        ws.send(JSON.stringify({ type: "running", running: true }));
      }
    },
    close(ws) {
      removeStream(ws.data.taskName, ws);
    },
    message() {
      // Client messages not needed for now
    },
  },
});

// Print the port so the Tauri shell can read it.
// The "SIDECAR_PORT:" prefix is parsed by the Rust sidecar manager.
// eslint-disable-next-line no-console -- startup log
console.log(`SIDECAR_PORT:${server.port}`);
