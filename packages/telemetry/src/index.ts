import { PostHog } from "posthog-node";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Set RALPH_POSTHOG_KEY to your PostHog project API key.
// Set RALPH_TELEMETRY=0 to opt out.
const POSTHOG_KEY =
  process.env["RALPH_POSTHOG_KEY"] ?? "phc_Bua8TpmaxSSM8h43htLrm6VUoaB2L9GZgA4kiEcMrpaY";
const HOST = "https://eu.i.posthog.com";

const enabled = process.env["RALPH_TELEMETRY"] !== "0";

let client: PostHog | null = null;
let distinctId = "anonymous";
let defaultProps: Record<string, unknown> = {};

/** Merge properties that will be included on every subsequent capture() call. */
export function setDefaultProperties(props: Record<string, unknown>): void {
  defaultProps = { ...defaultProps, ...props };
}

export async function init(): Promise<void> {
  if (!enabled) return;

  const idPath = join(homedir(), ".ralph", ".telemetry-id");
  const idFile = Bun.file(idPath);

  if (await idFile.exists()) {
    distinctId = (await idFile.text()).trim();
  } else {
    distinctId = randomUUID();
    await Bun.write(idPath, distinctId);
  }

  client = new PostHog(POSTHOG_KEY, {
    host: HOST,
    flushAt: 20,
    flushInterval: 0,
  });
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  const merged = { ...defaultProps, ...properties };
  client?.capture({ distinctId, event, properties: merged });
}

export async function shutdown(): Promise<void> {
  if (client) await client.shutdown();
}
