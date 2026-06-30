const LINEAR_API = "https://api.linear.app/graphql";

// ---------------------------------------------------------------------------
// Ticket-identifier parsing for the `--ticket` flag (RLF-208)
// ---------------------------------------------------------------------------

interface GraphQLResult<T> {
  data?: T;
  errors?: { message: string }[];
}

/** Test seam: override `sleep` to make retry backoff instant in unit tests. */
export const linearRequestInternals: { sleep: (ms: number) => Promise<void> } = {
  sleep: (ms: number) => Bun.sleep(ms),
};

const MAX_LINEAR_ATTEMPTS = 3;

const MAX_RETRY_AFTER_MS = 2000;

const BODY_TRUNCATE_CHARS = 512;

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function backoffMs(attempt: number): number {
  const base = 250 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

function isRateLimitedBody(body: unknown): boolean {
  if (typeof body !== "string" || body.length === 0) return false;
  return body.toLowerCase().includes("rate limit exceeded");
}

export function isRateLimitedError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  return (err as { rateLimited?: boolean }).rateLimited === true;
}

/** Render a Linear API error in a structured form: status + truncated body
 *  for HTTP failures, GraphQL `messages` joined by "; " when present,
 *  falling back to `err.message` / `String(err)` for anything else. */
export function formatLinearError(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (typeof err !== "object") return String(err);
  const e = err as {
    status?: number;
    body?: string;
    messages?: string[];
    message?: string;
    rateLimited?: boolean;
  };
  const parts: string[] = [];
  if (e.rateLimited) parts.push("rate limited");
  if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
  if (Array.isArray(e.messages) && e.messages.length > 0) {
    parts.push(`graphql: ${e.messages.join("; ")}`);
  }
  if (typeof e.body === "string" && e.body.length > 0 && !e.rateLimited) {
    const truncated =
      e.body.length > BODY_TRUNCATE_CHARS ? `${e.body.slice(0, BODY_TRUNCATE_CHARS)}…` : e.body;
    parts.push(`body: ${truncated}`);
  }
  if (parts.length === 0) {
    if (typeof e.message === "string" && e.message) return e.message;
    return String(err);
  }
  if (typeof e.message === "string" && e.message && !e.rateLimited) parts.unshift(e.message);
  return parts.join(" — ");
}

export async function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let lastHttpError:
    | (Error & { status?: number; body?: string; messages?: string[]; rateLimited?: boolean })
    | undefined;

  for (let attempt = 1; attempt <= MAX_LINEAR_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(LINEAR_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query, variables }),
      });
    } catch (netErr) {
      // Network-level failure (e.g. Bun's "The socket connection was closed
      // unexpectedly" when a keep-alive socket dies) — transient, retry with
      // the same backoff as 5xx.
      lastHttpError = netErr as Error;
      if (attempt < MAX_LINEAR_ATTEMPTS) {
        await linearRequestInternals.sleep(Math.min(backoffMs(attempt), MAX_RETRY_AFTER_MS));
        continue;
      }
      throw netErr;
    }
    if (!res.ok) {
      const err = new Error("Linear API request failed") as Error & {
        status?: number;
        body?: string;
        rateLimited?: boolean;
      };
      err.status = res.status;
      err.body = await res.text();
      const rateLimited = res.status === 429 || isRateLimitedBody(err.body);
      if (rateLimited) err.rateLimited = true;

      const retryable = rateLimited || isRetryableStatus(res.status);
      lastHttpError = err;
      if (retryable && attempt < MAX_LINEAR_ATTEMPTS) {
        const ra = parseRetryAfter(res.headers.get("Retry-After"));
        const waitMs = Math.min(ra ?? backoffMs(attempt), MAX_RETRY_AFTER_MS);
        await linearRequestInternals.sleep(waitMs);
        continue;
      }
      throw err;
    }
    const json = (await res.json()) as GraphQLResult<T>;
    if (json.errors?.length) {
      const err = new Error("Linear API returned errors") as Error & {
        messages?: string[];
      };
      err.messages = json.errors.map((e) => e.message);
      throw err;
    }
    if (!json.data) {
      throw new Error("Linear API returned no data");
    }
    return json.data;
  }
  throw lastHttpError ?? new Error("Linear API request failed");
}

/**
 * Fetch the authenticated Linear user — the owner of `apiKey`. Surfaced in
 * `agent list` and the agent view so a key that resolves `assignee: me` to the
 * wrong account (or no account) is visible, instead of silently returning zero
 * tickets. Returns `null` when the key is missing or does not resolve a viewer
 * (invalid / expired), so a bad key degrades to an explicit hint rather than
 * throwing.
 */
export async function fetchViewer(
  apiKey: string,
): Promise<{ id: string; name: string; email: string } | null> {
  if (!apiKey) return null;
  try {
    const data = await linearRequest<{
      viewer: { id: string; name: string; email: string } | null;
    }>(apiKey, "query { viewer { id name email } }", {});
    return data.viewer ?? null;
  } catch {
    return null;
  }
}
