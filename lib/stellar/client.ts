/**
 * One bounded HTTP client for every Stellar read.
 *
 * Bounded in four ways, each closing a failure this adapter would otherwise
 * inherit from whichever endpoint answered: a hard timeout so a hanging source
 * cannot hang a page, a response size cap so a wrong URL returning a large body
 * cannot be parsed into memory, redirects refused so a source cannot silently
 * move us to a host we never chose, and a JSON-RPC method allowlist.
 *
 * **It is a read boundary and says so by name.** `sendTransaction` is refused
 * explicitly rather than merely absent, the same shape as every other read
 * boundary in this product: the wallet broadcasting and Ryntra never broadcasting is
 * the product, and a boundary that relies on nobody adding a method later is
 * not a boundary.
 *
 * Nothing here throws into a caller. Every failure returns a reason, because
 * the caller's job is to turn it into `UNAVAILABLE` evidence, and an exception
 * crossing that seam produces a blank screen instead of an honest one.
 */

export type FetchOk<T> = Readonly<{ ok: true; value: T }>;
export type FetchFailure = Readonly<{ ok: false; reason: string }>;
export type FetchResult<T> = FetchOk<T> | FetchFailure;

export type ClientLimits = Readonly<{
  timeoutMs: number;
  maxBytes: number;
}>;

export const DEFAULT_LIMITS: ClientLimits = { timeoutMs: 8_000, maxBytes: 2_000_000 };

/**
 * The read-only JSON-RPC surface.
 *
 * An allowlist rather than a denylist: a new Stellar RPC method must be added
 * here deliberately, and the one that must never appear cannot arrive by
 * someone forgetting to exclude it.
 *
 * **`getLatestLedger` is deliberately absent**, and not for safety. A live probe
 * on 2026-08-13 measured its mainnet response at **3.18 MB** — `metadataXdr`
 * alone was 3,182,156 characters — to deliver four numbers this adapter
 * actually reads. `getHealth` carries the same ledger sequence and close time in
 * **207 bytes**, plus the endpoint's retention window. Allowlisting the large
 * one would mean pulling megabytes per page load, growing with mainnet traffic,
 * for data we discard.
 */
export const ALLOWED_RPC_METHODS = ["getNetwork", "getHealth", "getVersionInfo"] as const;
export type AllowedRpcMethod = (typeof ALLOWED_RPC_METHODS)[number];

/** Refused by name as well as by omission. */
export const REFUSED_RPC_METHODS = ["sendTransaction", "simulateTransaction"] as const;

type FetchLike = typeof globalThis.fetch;

async function readBounded(response: Response, maxBytes: number): Promise<FetchResult<string>> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return { ok: false, reason: `Response declared ${declared} bytes, over the ${maxBytes} limit.` };
  }
  const text = await response.text();
  /* Checked again after reading, because `content-length` is a claim by the
     server and a chunked response does not make one at all. */
  if (text.length > maxBytes) {
    return { ok: false, reason: `Response was ${text.length} bytes, over the ${maxBytes} limit.` };
  }
  return { ok: true, value: text };
}

/**
 * The transport. Every bound lives here so no caller can opt out of one.
 *
 * Text rather than JSON, because not every source Ryntra reads is JSON —
 * `stellar.toml` is a plain-text document served from a third-party domain, and
 * it needs exactly the same timeout, size cap and redirect refusal as an API.
 * Parsing is the layer above.
 */
export async function fetchText(
  url: string,
  init: RequestInit,
  limits: ClientLimits,
  fetchImpl: FetchLike,
  accept = "application/json",
): Promise<FetchResult<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      /* A source that wants to redirect us is a source that has moved. That is
         a decision for a person, not something to follow at read time. */
      redirect: "error",
      headers: { accept, ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      return { ok: false, reason: `${url} answered HTTP ${response.status}.` };
    }
    return readBounded(response, limits.maxBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: timedOut ? `${url} did not answer within ${limits.timeoutMs}ms.` : `${url} could not be reached: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function request(
  url: string,
  init: RequestInit,
  limits: ClientLimits,
  fetchImpl: FetchLike,
): Promise<FetchResult<unknown>> {
  const body = await fetchText(url, init, limits, fetchImpl);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.value) as unknown };
  } catch {
    return { ok: false, reason: `${url} answered with a body that is not JSON.` };
  }
}

/** A Horizon GET. Query parameters are encoded here, never string-joined by callers. */
export async function horizonGet(
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, string>> = {},
  options: { limits?: ClientLimits; fetchImpl?: FetchLike } = {},
): Promise<FetchResult<unknown>> {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return request(url.toString(), { method: "GET" }, options.limits ?? DEFAULT_LIMITS, options.fetchImpl ?? globalThis.fetch);
}

/**
 * A Stellar JSON-RPC call, restricted to the read allowlist.
 *
 * The refusal is a returned reason rather than a throw, so a caller that
 * mistakenly asks to submit gets an honest unavailable rather than a crash —
 * and the string names the method, so the mistake is visible in a log instead
 * of appearing as a generic failure.
 */
export async function stellarRpc(
  rpcUrl: string,
  method: string,
  params: unknown = {},
  options: { limits?: ClientLimits; fetchImpl?: FetchLike } = {},
): Promise<FetchResult<unknown>> {
  if (!(ALLOWED_RPC_METHODS as readonly string[]).includes(method)) {
    return { ok: false, reason: `"${method}" is not a permitted read method. This adapter reads; it never submits.` };
  }
  const answer = await request(
    rpcUrl,
    { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), headers: { "content-type": "application/json" } },
    options.limits ?? DEFAULT_LIMITS,
    options.fetchImpl ?? globalThis.fetch,
  );
  if (!answer.ok) return answer;

  const payload = answer.value as { result?: unknown; error?: { message?: string; code?: number } };
  if (payload && typeof payload === "object" && payload.error) {
    return { ok: false, reason: `${method} returned an RPC error: ${payload.error.message ?? "unspecified"}.` };
  }
  if (!payload || typeof payload !== "object" || !("result" in payload)) {
    return { ok: false, reason: `${method} returned no result field.` };
  }
  return { ok: true, value: payload.result };
}
