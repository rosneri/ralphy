import { join } from "node:path";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ToolRegistrar = {
  registerTool(name: string, config: unknown, callback: unknown): unknown;
};
import { readState, writeState, buildInitialState } from "@ralphy/core/state";
import { getStorage, runWithContext, createDefaultContext } from "@ralphy/context";
import type { ChangeStore } from "@ralphy/change-store";

// Narrow structural interface avoids TS2589 deep inference from the MCP SDK's
// dual Zod v3/v4 schema union in registerTool's signature.
function safeTool<T extends Record<string, z.ZodTypeAny>>(
  server: ToolRegistrar,
  name: string,
  config: { description: string; inputSchema: T },
  callback: (args: { [K in keyof T]: z.infer<T[K]> }) => CallToolResult | Promise<CallToolResult>,
): void {
  server.registerTool(name, config, callback);
}

export interface RegisterToolsHooks {
  /** Invoked after `ralph_append_steering` successfully writes steering.md
   *  + tasks.md. Lets an embedded coordinator post a fresh Linear
   *  steering comment and refresh the tasks comment. No-op when omitted
   *  (standalone MCP runs). Errors are logged via stderr but never
   *  surface to the MCP client so the tool stays idempotent. */
  onSteeringAppended?: (changeName: string, message: string) => Promise<void> | void;
}

export function registerTools(
  server: ToolRegistrar,
  changesDir: string,
  changeStore: ChangeStore,
  taskFilesDir: string = changesDir,
  hooks: RegisterToolsHooks = {},
): void {
  // --- ralph_list_changes ---
  safeTool(
    server,
    "ralph_list_changes",
    {
      description: "List all active OpenSpec changes with their status",
      inputSchema: {
        includeCompleted: z.boolean().optional().describe("Include completed changes"),
      },
    },
    async ({ includeCompleted }) => {
      return runWithContext(createDefaultContext(), async () => {
        try {
          const storage = getStorage();
          const names = await changeStore.listChanges();
          const changes = [];

          for (const name of names) {
            const changeDir = join(changesDir, name);
            try {
              const state = readState(changeDir);
              if (!includeCompleted && state.status === "completed") continue;
              changes.push({
                name: state.name,
                status: state.status,
                iteration: state.iteration,
                engine: state.engine,
                model: state.model,
                createdAt: state.createdAt,
                lastModified: state.lastModified,
              });
            } catch {
              // Also try listing from the changes directory directly
              const stateRaw = storage.read(join(changeDir, ".ralph-state.json"));
              if (stateRaw !== null) {
                changes.push({ name, status: "unknown" });
              }
            }
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify({ changes }, null, 2) }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error listing changes: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      });
    },
  );

  // --- ralph_get_change ---
  safeTool(
    server,
    "ralph_get_change",
    {
      description: "Get detailed information about a specific OpenSpec change",
      inputSchema: { name: z.string().describe("Change name") },
    },
    async ({ name }) => {
      return runWithContext(createDefaultContext(), () => {
        try {
          const storage = getStorage();
          const changeDir = join(changesDir, name);
          const state = readState(changeDir);

          const taskDir = join(taskFilesDir, name);
          const tasksContent = storage.read(join(taskDir, "tasks.md"));
          const proposalContent = storage.read(join(taskDir, "proposal.md"));

          const result = {
            name: state.name,
            prompt: state.prompt,
            status: state.status,
            iteration: state.iteration,
            engine: state.engine,
            model: state.model,
            createdAt: state.createdAt,
            lastModified: state.lastModified,
            metadata: state.metadata,
            historyLength: state.history.length,
            hasTasks: tasksContent !== null,
            hasProposal: proposalContent !== null,
          };

          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error getting change '${name}': ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      });
    },
  );

  // --- ralph_create_change ---
  safeTool(
    server,
    "ralph_create_change",
    {
      description: "Create a new OpenSpec change and optionally start running it in the background",
      inputSchema: {
        name: z.string().describe("Change name (used as directory name)"),
        prompt: z.string().describe("Change description / prompt"),
        engine: z.string().optional().describe("Engine to use (default: claude)"),
        model: z.string().optional().describe("Model to use (default: opus)"),
        run: z.boolean().optional().describe("Start running the change immediately"),
        maxIterations: z.number().optional().describe("Maximum iterations to run"),
        maxCostUsd: z.number().optional().describe("Stop when total cost exceeds this USD amount"),
        maxRuntimeMinutes: z
          .number()
          .optional()
          .describe("Stop after this many minutes of wall-clock time"),
      },
    },
    async ({ name, prompt, engine, model, run, maxIterations, maxCostUsd, maxRuntimeMinutes }) => {
      return runWithContext(createDefaultContext(), () => {
        try {
          const changeDir = join(changesDir, name);
          const stateExists = getStorage().read(join(changeDir, ".ralph-state.json")) !== null;

          if (!stateExists) {
            const state = buildInitialState({
              name,
              prompt,
              ...(engine !== undefined && { engine }),
              ...(model !== undefined && { model }),
            });
            writeState(changeDir, state);
          }

          if (!run) {
            const taskFilesPath = join(taskFilesDir, name);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      created: name,
                      stateDir: changeDir,
                      taskFilesDir: taskFilesPath,
                      note: "Write proposal.md, design.md, tasks.md, specs/ to taskFilesDir. State (.ralph-state.json) is managed automatically in stateDir.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const cliArgs = ["run", "apps/shell/src/index.ts", "loop", "task", "--name", name];
          if (maxIterations) cliArgs.push("--max-iterations", String(maxIterations));
          if (maxCostUsd) cliArgs.push("--max-cost", String(maxCostUsd));
          if (maxRuntimeMinutes) cliArgs.push("--max-runtime", String(maxRuntimeMinutes));
          if (engine) cliArgs.push("--" + engine);
          if (model) cliArgs.push("--model", model);

          const child = Bun.spawn({
            cmd: ["bun", ...cliArgs],
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          });
          child.unref();

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ created: name, started: true, pid: child.pid }, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error creating change: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      });
    },
  );

  // --- ralph_append_steering ---
  safeTool(
    server,
    "ralph_append_steering",
    {
      description:
        "Append a steering message to the ## Steering section in proposal.md for a change",
      inputSchema: {
        name: z.string().describe("Change name"),
        message: z.string().describe("Steering message to append"),
      },
    },
    async ({ name, message }) => {
      return runWithContext(createDefaultContext(), async () => {
        try {
          const changeDir = join(changesDir, name);
          if (getStorage().read(join(changeDir, ".ralph-state.json")) === null) {
            return {
              content: [{ type: "text" as const, text: `Change '${name}' does not exist` }],
              isError: true,
            };
          }

          await changeStore.appendSteering(name, message);

          if (hooks.onSteeringAppended) {
            try {
              await hooks.onSteeringAppended(name, message);
            } catch (err) {
              // Best-effort — never surface to the MCP client.
              process.stderr.write(
                `! onSteeringAppended hook failed for ${name}: ${
                  err instanceof Error ? err.message : String(err)
                }\n`,
              );
            }
          }

          return {
            content: [{ type: "text" as const, text: `Steering appended to change '${name}'` }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error appending steering: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      });
    },
  );

  // --- ralph_stop ---
  safeTool(
    server,
    "ralph_stop",
    {
      description: "Stop a running change by writing a STOP signal file",
      inputSchema: {
        name: z.string().describe("Change name"),
        reason: z.string().optional().describe("Reason for stopping"),
      },
    },
    async ({ name, reason }) => {
      return runWithContext(createDefaultContext(), () => {
        try {
          const taskDir = join(taskFilesDir, name);
          getStorage().write(join(taskDir, "STOP"), reason ?? "Stopped via MCP");

          return {
            content: [{ type: "text" as const, text: `Stop signal written for change '${name}'` }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error stopping change: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      });
    },
  );
}
