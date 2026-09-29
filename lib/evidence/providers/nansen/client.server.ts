/**
 * The Nansen HTTP client — the one place the key is read, the one place a
 * request leaves, bounded in time and in retries.
 *
 * Every request is `POST` with the `apikey` header and a JSON body, as the
 * provider documents; the endpoint must be one the rights map allows the
 * product to call — any other path is refused here before a socket opens.
 * The key is read once from the environment, never logged, never serialized,
 * never echoed in an error. The answer's credit and request headers are read
 * off every response so the governor can settle on the provider's own
 * figures; the body is handed to the adapter and dropped.
 *
 * Retries are one, and only for the failures a second try can mend — a
 * network error, a timeout, a 5xx. A 4xx is the provider's answer and a
 * second identical request would buy the same answer twice; a 429 is
 * honoured, not argued with. A provider retry never becomes a retry of
 * anything financial: this client knows nothing but a read.
 */

import { callableFamilies, NANSEN_RIGHTS } from "../../rights.ts";

export const NANSEN_BASE_URL = "https://api.nansen.ai";
export const NANSEN_TIMEOUT_MS = 8_000;

export type NansenHeaders = Readonly<{
  creditsCost: number | null;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
  rateLimitRemaining: number | null;
}>;

export type NansenFailureKind = "auth" | "credits" | "geo" | "rate" | "invalid" | "server" | "timeout" | "network" | "refused";

export type NansenCall =
  | Readonly<{ ok: true; status: number; json: unknown; headers: NansenHeaders; ms: number; retried: boolean; family: string }>
  | Readonly<{ ok: false; kind: NansenFailureKind; status: number; code: string | null; message: string; headers: NansenHeaders; ms: number; retried: boolean; family: string }>;

export type NansenClient = Readonly<{
  /** Whether a key is present; the client never says what it is. */
  configured: boolean;
  call(family: string, body: Readonly<Record<string, unknown>>): Promise<NansenCall>;
}>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const EMPTY_HEADERS: NansenHeaders = { creditsCost: null, creditsUsed: null, creditsRemaining: null, requestId: null, retryAfterSeconds: null, rateLimitRemaining: null };

function integer(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function readNansenHeaders(headers: Headers): NansenHeaders {
  return {
    creditsCost: integer(headers.get("x-nansen-credits-cost")),
    creditsUsed: integer(headers.get("x-nansen-credits-used")),
    creditsRemaining: integer(headers.get("x-nansen-credits-remaining")),
    requestId: headers.get("x-request-id"),
    retryAfterSeconds: integer(headers.get("retry-after")),
    rateLimitRemaining: integer(headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining")),
  };
}

function failureKind(status: number, code: string | null): NansenFailureKind {
  if (status === 401) return "auth";
  if (status === 402 || code === "insufficient_credits") return "credits";
  if (status === 403) return code === "geo_blocked" ? "geo" : "auth";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "invalid";
}

function withoutKey(message: string, key: string): string {
  return key.length > 0 ? message.split(key).join("[key]") : message;
}

export function createNansenClient(input: { key: string | null; fetchImpl?: FetchLike; baseUrl?: string; timeoutMs?: number }): NansenClient {
  const key = input.key;
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const baseUrl = input.baseUrl ?? NANSEN_BASE_URL;
  const timeoutMs = input.timeoutMs ?? NANSEN_TIMEOUT_MS;
  const allowed = new Map(callableFamilies(NANSEN_RIGHTS).map((family) => [family.family, family.path]));

  async function once(family: string, path: string, body: Readonly<Record<string, unknown>>, retried: boolean): Promise<NansenCall> {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(baseUrl + path, {
        method: "POST",
        headers: { apikey: key ?? "", "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const ms = Date.now() - started;
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { ok: false, kind: timeout ? "timeout" : "network", status: 0, code: null, message: timeout ? `No answer within ${timeoutMs} ms.` : withoutKey(error instanceof Error ? error.message : String(error), key ?? ""), headers: EMPTY_HEADERS, ms, retried, family };
    }
    const ms = Date.now() - started;
    const headers = readNansenHeaders(response.headers);
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok) return { ok: true, status: response.status, json, headers, ms, retried, family };
    const envelope = json && typeof json === "object" ? (json as { code?: unknown; message?: unknown }) : {};
    const code = typeof envelope.code === "string" ? envelope.code : null;
    const message = typeof envelope.message === "string" ? withoutKey(envelope.message, key ?? "").slice(0, 200) : `HTTP ${response.status}`;
    return { ok: false, kind: failureKind(response.status, code), status: response.status, code, message, headers, ms, retried, family };
  }

  return {
    configured: typeof key === "string" && key.length > 0,
    async call(family, body) {
      const path = allowed.get(family);
      if (!path) return { ok: false, kind: "refused", status: 0, code: null, message: `The family ${family} is not one the product may call.`, headers: EMPTY_HEADERS, ms: 0, retried: false, family };
      if (!key) return { ok: false, kind: "auth", status: 0, code: null, message: "No provider key is configured.", headers: EMPTY_HEADERS, ms: 0, retried: false, family };
      const first = await once(family, path, body, false);
      if (first.ok) return first;
      const mendable = first.kind === "network" || first.kind === "timeout" || first.kind === "server";
      if (!mendable) return first;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return once(family, path, body, true);
    },
  };
}

export function nansenKeyFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  const key = env.NANSEN_API_KEY;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}
