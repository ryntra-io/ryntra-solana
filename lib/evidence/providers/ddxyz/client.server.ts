/**
 * The DD.xyz / Webacy HTTP client — the one place the key is read, the one
 * place a request leaves, bounded in time, in pace and in retries.
 *
 * Every request is `GET` with the `x-api-key` header and `chain=sol` named
 * explicitly on the query — the provider defaults to Ethereum when the chain
 * is omitted and refuses the Solana-only family without it, so the chain is
 * never left to a default. The family must be one the rights map allows the
 * product to call — a plan-gated or unsupported family is refused here
 * before a socket opens. The key is read once from the environment, never
 * logged, never serialized, never echoed in an error.
 *
 * Pace: the demo tier allows one request a second with a burst of two, so
 * calls through one client are spaced a second apart within this instance;
 * a 429 is honoured, never argued with. Retries are one and only for the
 * failures a second try can mend — a network error or a timeout; a 5xx is
 * the provider's answer for that subject (the stage-A smoke saw a mint that
 * answers 500 deterministically) and a second identical call would buy the
 * same answer twice at the same price. Every successful answer carries the
 * provider's own price in `x-webacy-cu`, read off the response for the
 * governor's settlement; the body is handed to the adapter and dropped.
 */

import { callableFamilies, DDXYZ_RIGHTS } from "../../rights.ts";

export const DDXYZ_BASE_URL = "https://api.webacy.com";
/** A cold Trading Lite analysis takes five to seven seconds; twelve leaves room without holding a page for long. */
export const DDXYZ_TIMEOUT_MS = 12_000;
/** The demo tier's own pace: one request a second. */
export const DDXYZ_MIN_GAP_MS = 1_000;
const CHAIN = "sol";

export type DdxyzHeaders = Readonly<{
  /** The provider's price of this call, from `x-webacy-cu`; null when the answer carried none. */
  computeUnits: number | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
  rateLimitRemaining: number | null;
}>;

export type DdxyzFailureKind = "auth" | "plan" | "payment" | "rate" | "invalid" | "notfound" | "server" | "timeout" | "network" | "refused";

export type DdxyzCall =
  | Readonly<{ ok: true; status: number; json: unknown; headers: DdxyzHeaders; ms: number; retried: boolean; family: string }>
  | Readonly<{ ok: false; kind: DdxyzFailureKind; status: number; message: string; headers: DdxyzHeaders; ms: number; retried: boolean; family: string }>;

/** The provider's own metering, read for reconciliation only: the global figures and the per-route counters as it reports them. */
export type DdxyzUsage = Readonly<{
  readAt: string;
  /** The largest `remaining` and `limit` the routes report — the provider prints the account's figures on every route. */
  remaining: number | null;
  limit: number | null;
  /** Served requests per route as the provider counts them (its counters lag by minutes). */
  routes: readonly Readonly<{ route: string; used: number }>[];
}>;

export type DdxyzClient = Readonly<{
  /** Whether a key is present; the client never says what it is. */
  configured: boolean;
  /** Call one family for one subject (a mint or an address), with the chain named. */
  call(family: string, subject: string): Promise<DdxyzCall>;
  /** `GET /usage/current` — the provider's own count, for the admin's reconciliation; a request at the provider like any other, so callers cache it. */
  usage(): Promise<DdxyzUsage | null>;
}>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const EMPTY_HEADERS: DdxyzHeaders = { computeUnits: null, requestId: null, retryAfterSeconds: null, rateLimitRemaining: null };

function integer(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function readDdxyzHeaders(headers: Headers): DdxyzHeaders {
  return {
    computeUnits: integer(headers.get("x-webacy-cu")),
    requestId: headers.get("x-amzn-requestid") ?? headers.get("x-request-id"),
    retryAfterSeconds: integer(headers.get("retry-after")),
    rateLimitRemaining: integer(headers.get("x-ratelimit-remaining")),
  };
}

function failureKind(status: number): DdxyzFailureKind {
  if (status === 401) return "auth";
  if (status === 402) return "payment";
  if (status === 403) return "plan";
  if (status === 404) return "notfound";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "invalid";
}

function withoutKey(message: string, key: string): string {
  return key.length > 0 ? message.split(key).join("[key]") : message;
}

/** The provider's error bodies come in two shapes: `{statusCode, message, path, timestamp}` from the gateway and `{message}` from plan gating. */
function messageOf(json: unknown, status: number, key: string): string {
  const envelope = json && typeof json === "object" ? (json as { message?: unknown }) : {};
  return typeof envelope.message === "string" ? withoutKey(envelope.message, key).slice(0, 200) : `HTTP ${status}`;
}

export function createDdxyzClient(input: { key: string | null; fetchImpl?: FetchLike; baseUrl?: string; timeoutMs?: number; minGapMs?: number }): DdxyzClient {
  const key = input.key;
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const baseUrl = input.baseUrl ?? DDXYZ_BASE_URL;
  const timeoutMs = input.timeoutMs ?? DDXYZ_TIMEOUT_MS;
  const minGapMs = input.minGapMs ?? DDXYZ_MIN_GAP_MS;
  const allowed = new Map(callableFamilies(DDXYZ_RIGHTS).map((family) => [family.family, family.path]));

  /* One lane: the next request starts no sooner than a second after the
     previous one started, whichever caller asks. */
  let lane: Promise<void> = Promise.resolve();
  let lastStartedAt = 0;
  function paced<T>(work: () => Promise<T>): Promise<T> {
    const turn = lane.then(async () => {
      const wait = lastStartedAt + minGapMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastStartedAt = Date.now();
    });
    lane = turn.catch(() => undefined);
    return turn.then(work);
  }

  async function once(family: string, path: string, retried: boolean): Promise<DdxyzCall> {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(baseUrl + path, {
        method: "GET",
        headers: { "x-api-key": key ?? "", accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const ms = Date.now() - started;
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { ok: false, kind: timeout ? "timeout" : "network", status: 0, message: timeout ? `No answer within ${timeoutMs} ms.` : withoutKey(error instanceof Error ? error.message : String(error), key ?? ""), headers: EMPTY_HEADERS, ms, retried, family };
    }
    const ms = Date.now() - started;
    const headers = readDdxyzHeaders(response.headers);
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok) return { ok: true, status: response.status, json, headers, ms, retried, family };
    return { ok: false, kind: failureKind(response.status), status: response.status, message: messageOf(json, response.status, key ?? ""), headers, ms, retried, family };
  }

  return {
    configured: typeof key === "string" && key.length > 0,
    async call(family, subject) {
      const template = allowed.get(family);
      if (!template) return { ok: false, kind: "refused", status: 0, message: `The family ${family} is not one the product may call.`, headers: EMPTY_HEADERS, ms: 0, retried: false, family };
      if (!key) return { ok: false, kind: "auth", status: 0, message: "No provider key is configured.", headers: EMPTY_HEADERS, ms: 0, retried: false, family };
      const path = `${template.replace(/\{(mint|address)\}/, encodeURIComponent(subject))}?chain=${CHAIN}`;
      const first = await paced(() => once(family, path, false));
      if (first.ok) return first;
      const mendable = first.kind === "network" || first.kind === "timeout";
      if (!mendable) return first;
      return paced(() => once(family, path, true));
    },
    async usage() {
      if (!key) return null;
      const call = await paced(() => once("usage", "/usage/current", false));
      if (!call.ok || !call.json || typeof call.json !== "object") return null;
      const routes: { route: string; used: number }[] = [];
      let remaining: number | null = null;
      let limit: number | null = null;
      for (const [route, figures] of Object.entries(call.json as Record<string, unknown>)) {
        if (!figures || typeof figures !== "object") continue;
        const { used, remaining: left, limit: cap } = figures as { used?: unknown; remaining?: unknown; limit?: unknown };
        if (typeof used === "number" && Number.isFinite(used) && used > 0) routes.push({ route: route.slice(0, 64), used: Math.round(used) });
        if (typeof left === "number" && Number.isFinite(left)) remaining = remaining === null ? Math.round(left) : Math.max(remaining, Math.round(left));
        if (typeof cap === "number" && Number.isFinite(cap)) limit = limit === null ? Math.round(cap) : Math.max(limit, Math.round(cap));
      }
      return { readAt: new Date().toISOString(), remaining, limit, routes: routes.slice(0, 24) };
    },
  };
}

export function ddxyzKeyFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  const key = env.DDXYZ_API_KEY;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}
