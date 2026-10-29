/**
 * One request, done properly: the contract major named, the answer parsed, the
 * refusal turned into the right class, and a retry only where a retry is safe.
 *
 * **The idempotency key.** Every request that is not a GET carries
 * `Idempotency-Key`. The caller may supply it, and should when retrying: the
 * point of the key is that the *same intent* keeps the *same key*, so a key
 * minted fresh per attempt would be a key that proves nothing. When the caller
 * supplies none, one is minted for that one call.
 *
 * No route reads the header yet — the document says so plainly in
 * `x-ryntra-idempotency.honouredBy`, which is empty — because the store that
 * would remember a key belongs with the developer console's API keys. The
 * header is sent now so that the retry story is settled before the first
 * write rather than after it, and the honest consequence is drawn here rather
 * than papered over: a non-GET is **never** retried automatically, because
 * until the server remembers the key, retrying a write is simply writing
 * twice.
 *
 * A GET is retried, up to `retries`, and only on a failure the contract's own
 * error table calls retryable. `Retry-After` is obeyed when the server sends
 * it, because a client that ignores it is the reason rate limits get stricter.
 */

import { RyntraApiError, RyntraProtocolError, RyntraRouteError, RyntraTransportError } from "./errors.ts";
import { API_HEADER, CONTRACT_MAJOR, API_VERSION_HEADER, IDEMPOTENCY_HEADER } from "./generated/contract.ts";

/** The slice of `fetch` this package uses, so a caller can hand it any client. */
export type FetchLike = (
  input: string,
  init: Readonly<{ method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }>,
) => Promise<Readonly<{ status: number; headers: Readonly<{ get(name: string): string | null }>; text(): Promise<string> }>>;

export type TransportOptions = Readonly<{
  /** `https://ryntra.io`, or a stand. A trailing slash is trimmed. */
  baseUrl: string;
  /** The caller's fetch; `globalThis.fetch` when omitted. */
  fetch?: FetchLike;
  /** Extra headers on every request — a `user-agent`, an integration id. */
  headers?: Readonly<Record<string, string>>;
  /** How many times a *GET* may be asked again after a retryable failure. Default 2; 0 turns it off. */
  retries?: number;
  /** Milliseconds before a request is abandoned. Default 15000; 0 turns it off. */
  timeoutMs?: number;
  /** Waits between retries. Swapped out by the tests so they do not sleep. */
  wait?: (ms: number) => Promise<void>;
}>;

export type RequestInit = Readonly<{
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The path with its parameters already in it, query string and all. */
  path: string;
  body?: unknown;
  /** The read this belongs to, so an error can name it. */
  operationId?: string | null;
  /**
   * The key for a non-GET. Supply the same one on every attempt at the same
   * intent; omit it and one is minted for this call alone.
   */
  idempotencyKey?: string;
}>;

/** A key for one intent. Keep it across retries of that intent, not across intents. */
export function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  /* No Web Crypto (an old runtime, a stripped sandbox): random enough for a
     key whose only job is to be the same string twice and a different string
     next time. */
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 14)}`;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Whole seconds, from a `Retry-After` the server may not have sent. */
function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Is this a `/api/v1` path, with the contract's one error shape and its version header? */
const isV1 = (path: string): boolean => path.startsWith("/api/v1/");

type Answer = Readonly<{ status: number; body: unknown; contractVersion: string | null; retryAfterSeconds: number | null }>;

function refusal(init: RequestInit, answer: Answer, text: string): never {
  const operationId = init.operationId ?? null;
  const shared = { operationId, status: answer.status, retryAfterSeconds: answer.retryAfterSeconds };
  const error = answer.body && typeof answer.body === "object" ? (answer.body as { error?: unknown }).error : undefined;

  if (error && typeof error === "object") {
    const row = error as Readonly<{ code?: unknown; message?: unknown; issues?: unknown; minimumAppVersion?: unknown }>;
    if (typeof row.code === "string") {
      const message = typeof row.message === "string" ? row.message : row.code;
      if (isV1(init.path)) {
        throw new RyntraApiError({
          ...shared,
          code: row.code,
          message,
          contractVersion: answer.contractVersion,
          issues: Array.isArray(row.issues) ? (row.issues as RyntraApiError["issues"]) : [],
          minimumAppVersion: typeof row.minimumAppVersion === "string" ? row.minimumAppVersion : null,
        });
      }
      throw new RyntraRouteError({ ...shared, code: row.code, message, details: error as Readonly<Record<string, unknown>> });
    }
  }

  /* An older route names its refusal as a bare string (`{ error: "proof required" }`). */
  if (typeof error === "string") {
    throw new RyntraRouteError({
      ...shared,
      code: `HTTP_${answer.status}`,
      message: error,
      details: answer.body as Readonly<Record<string, unknown>>,
    });
  }

  throw new RyntraProtocolError({ ...shared, message: `HTTP ${answer.status} without the error shape the contract describes.`, body: text });
}

export type Transport = Readonly<{
  /** The base URL every request goes to, trailing slash trimmed. */
  baseUrl: string;
  /** One request. Resolves with the parsed body of a 2xx; throws one of the five error classes otherwise. */
  request: (init: RequestInit) => Promise<unknown>;
}>;

export function createTransport(options: TransportOptions): Transport {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const wait = options.wait ?? sleep;

  async function once(init: RequestInit): Promise<unknown> {
    const method = init.method ?? "GET";
    const headers: Record<string, string> = {
      accept: "application/json",
      [API_HEADER]: String(CONTRACT_MAJOR),
      ...(options.headers ?? {}),
    };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers[IDEMPOTENCY_HEADER] = init.idempotencyKey ?? newIdempotencyKey();

    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await doFetch(`${baseUrl}${init.path}`, {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (failure) {
      throw new RyntraTransportError({
        operationId: init.operationId ?? null,
        message: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new RyntraProtocolError({
        operationId: init.operationId ?? null,
        status: response.status,
        message: "the answer was not JSON",
        body: text,
      });
    }

    const answer: Answer = {
      status: response.status,
      body,
      contractVersion: isV1(init.path) ? response.headers.get(API_VERSION_HEADER) : null,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    };
    if (response.status >= 200 && response.status < 300) return body;
    refusal(init, answer, text);
  }

  async function request(init: RequestInit): Promise<unknown> {
    const method = init.method ?? "GET";
    /* A write is attempted exactly once; see the note at the top of the file. */
    const attempts = method === "GET" ? retries + 1 : 1;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await once(init);
      } catch (failure) {
        last = failure;
        const retryable = failure instanceof RyntraTransportError || (failure instanceof RyntraApiError && failure.retryable) || (failure instanceof RyntraRouteError && failure.retryable);
        if (!retryable || attempt === attempts) throw failure;
        const asked = failure instanceof Error && "retryAfterSeconds" in failure ? (failure as { retryAfterSeconds: number | null }).retryAfterSeconds : null;
        await wait(asked !== null ? asked * 1000 : 250 * 2 ** (attempt - 1));
      }
    }
    throw last;
  }

  return { baseUrl, request };
}
