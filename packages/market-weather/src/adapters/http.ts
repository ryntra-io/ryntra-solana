/**
 * One bounded GET of a public JSON endpoint. The only network door in this package.
 *
 * - GET only, https only, no credentials, no body: the package reads and never writes.
 * - A timeout, and a byte ceiling: a body past it is a fault, not data.
 * - No retry on 429 (asking again is the wrong answer to «too many») and none after a timeout.
 *
 * Nothing throws: every failure comes back as a value with a code and a reason.
 */

export type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type ReadDeps = Readonly<{
  fetch?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  /** The clock for `readAt`; tests pin it. */
  now?: () => number;
}>;

export type JsonRead =
  | Readonly<{ ok: true; url: string; readAt: string; body: unknown }>
  | Readonly<{ ok: false; url: string; readAt: string; code: "URL" | "HTTP" | "RATE_LIMITED" | "TIMEOUT" | "NETWORK" | "TOO_LARGE" | "SHAPE"; reason: string }>;

export const DEFAULT_TIMEOUT_MS = 6_000;
export const DEFAULT_MAX_BYTES = 2_000_000;

export async function readJson(url: string, deps: ReadDeps = {}): Promise<JsonRead> {
  const now = deps.now ?? Date.now;
  const readAt = new Date(now()).toISOString();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, url, readAt, code: "URL", reason: "not a URL" };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return { ok: false, url, readAt, code: "URL", reason: "only plain https URLs are read" };
  }
  const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, url, readAt, code: "TIMEOUT", reason: `no answer within ${timeoutMs} ms` };
    return { ok: false, url, readAt, code: "NETWORK", reason: error instanceof Error ? error.message : String(error) };
  }
  if (response.status === 429) return { ok: false, url, readAt, code: "RATE_LIMITED", reason: "rate limit reached" };
  if (!response.ok) return { ok: false, url, readAt, code: "HTTP", reason: `HTTP ${response.status}` };
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { ok: false, url, readAt, code: "NETWORK", reason: error instanceof Error ? error.message : String(error) };
  }
  if (text.length > maxBytes) return { ok: false, url, readAt, code: "TOO_LARGE", reason: `body over ${maxBytes} bytes` };
  try {
    return { ok: true, url, readAt, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, url, readAt, code: "SHAPE", reason: "not JSON" };
  }
}
