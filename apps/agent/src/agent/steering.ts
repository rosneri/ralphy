import { appendSteeringMessage } from "@ralphy/core/loop";
import { runWithContext, createDefaultContext } from "@ralphy/context";

/**
 * Append a steering message to the change's steering.md, wrapped in a default
 * context so the underlying storage helpers in `@ralphy/core` have an active
 * AsyncLocalStorage scope (mirroring the sidecar's `/steer` route).
 */
export async function appendSteering(changeDir: string, message: string): Promise<void> {
  await runWithContext(createDefaultContext(), async () => {
    appendSteeringMessage(changeDir, message);
  });
}
