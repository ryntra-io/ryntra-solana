/**
 * The one error of the model gateway (CITY-45, decision 72). Every failure —
 * a missing key, a spent budget, a provider that did not answer in time — is a
 * `ModelGatewayError` with a `kind` the caller can switch on: the Vault refunds
 * an entry on a model's failure, the Ring replays a match on a network's, and
 * neither reads an English message to decide.
 *
 * Pure: no store, no clock, no network.
 */

export const MODEL_ERROR_KINDS = [
  /** No OpenRouter key in the server's environment (or an empty one handed in). */
  "no_key",
  /** The request itself is wrong: an alias instead of a pinned model, no provider, a budget out of bounds, a 400. */
  "invalid_request",
  /** OpenRouter refused the key (401). */
  "unauthorized",
  /** The key was switched off (401 or 403 saying the key is disabled) — a guard's or an agent's key after its game ended. */
  "key_disabled",
  /** The key's own dollar limit is spent (`limit_source: "openrouter_key_limit"`, «Key limit exceeded»): this agent's or guard's budget, not the account's. */
  "budget_exhausted",
  /** A budget above the key is spent — the workspace's or a guardrail's (`openrouter_workspace_budget`, `openrouter_guardrail_budget`): every key under it stops until it resets or is raised. */
  "account_budget_exhausted",
  /** The OpenRouter account has no credits left (402): Ryntra's balance, not the agent's limit. */
  "out_of_credits",
  /** The provider's moderation flagged the input (403 with the flag's reasons). */
  "moderated",
  /** Any other 403: a guardrail blocked the request, or the key may not do this (a calling key where a management key is needed). */
  "forbidden",
  /** Too many requests (429), or the account's in-flight budget is full for now (402 `openrouter_in_flight_budget`). */
  "rate_limited",
  /** No answer within the call's time budget. */
  "timeout",
  /** The caller's own signal stopped the call. */
  "aborted",
  /** The pinned provider cannot serve the call now (5xx, an error inside the answer). */
  "provider_unavailable",
  /** The request never reached OpenRouter (DNS, connection reset). */
  "network",
  /** OpenRouter answered with something that is not a reply: no choices, bad JSON, structured output that does not parse. */
  "invalid_response",
  /** The thing asked for does not exist: a key hash, a model missing from the catalog, no endpoint of the pinned providers (404). */
  "not_found",
] as const;

export type ModelErrorKind = (typeof MODEL_ERROR_KINDS)[number];

/** Kinds where trying the same call again later can succeed; the rest need a person or a new key. */
const RETRYABLE: ReadonlySet<ModelErrorKind> = new Set(["rate_limited", "timeout", "provider_unavailable", "network"]);

export class ModelGatewayError extends Error {
  readonly kind: ModelErrorKind;
  /** The HTTP status OpenRouter answered with; `null` when no response came back. */
  readonly status: number | null;
  readonly retryable: boolean;
  /** How long OpenRouter asked to wait before trying again (`Retry-After`), in ms; `null` when it did not say. */
  readonly retryAfterMs: number | null;

  constructor(kind: ModelErrorKind, message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ModelGatewayError";
    this.kind = kind;
    this.status = status;
    this.retryable = RETRYABLE.has(kind);
    this.retryAfterMs = retryAfterMs;
  }
}

export function isModelGatewayError(value: unknown): value is ModelGatewayError {
  return value instanceof ModelGatewayError;
}

type ErrorBody = Readonly<{ message: string; metadata: Readonly<Record<string, unknown>> | null }>;

/** OpenRouter's error body: `{ error: { code, message, metadata? } }`; anything else reads as no message. */
export function readErrorBody(raw: unknown): ErrorBody {
  const error = raw && typeof raw === "object" ? (raw as { error?: unknown }).error : undefined;
  if (!error || typeof error !== "object") return { message: "", metadata: null };
  const record = error as { message?: unknown; metadata?: unknown };
  const message = typeof record.message === "string" ? record.message.slice(0, 500) : "";
  const metadata = record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : null;
  return { message, metadata };
}

/** `Retry-After` in whole seconds as ms (at most a day); an HTTP date or anything else is `null` — no clock here. */
export function retryAfterMsOf(header: string | null | undefined): number | null {
  const text = typeof header === "string" ? header.trim() : "";
  if (!/^\d{1,6}$/.test(text)) return null;
  return Math.min(Number(text), 86_400) * 1_000;
}

/**
 * Which limit OpenRouter says was hit: `error.metadata.limit_source` on the
 * newer format; on the older one only «Key limit exceeded» in the message
 * (a 403, seen live 07.09.2026), which is the key's own limit.
 */
type LimitHit = "key" | "account" | "in_flight" | null;

const ACCOUNT_LIMIT_SOURCES = new Set(["openrouter_workspace_budget", "openrouter_guardrail_budget"]);

function limitHit(body: ErrorBody): LimitHit {
  const source = body.metadata?.limit_source;
  if (source === "openrouter_key_limit") return "key";
  if (typeof source === "string" && ACCOUNT_LIMIT_SOURCES.has(source)) return "account";
  if (source === "openrouter_in_flight_budget") return "in_flight";
  if (/key limit exceeded/i.test(body.message)) return "key";
  return null;
}

function moderationHit(body: ErrorBody): boolean {
  if (body.metadata && (Array.isArray(body.metadata.reasons) || typeof body.metadata.flagged_input === "string")) return true;
  return /\bmoderation\b|\bflagged\b/i.test(body.message);
}

/** «This API key is disabled» — the key named as switched off, not a model or a feature a guardrail turned off. */
const keyDisabled = (body: ErrorBody): boolean => /\bkey\b.*\bdisabled\b|\bdisabled\b.*\bkey\b/i.test(body.message);

/** The kind of an HTTP failure from its status, OpenRouter's error body and its `Retry-After` header. */
export function classifyHttpFailure(status: number, raw: unknown, retryAfter: string | null = null): ModelGatewayError {
  const body = readErrorBody(raw);
  const said = body.message ? `: ${body.message}` : "";
  const wait = retryAfterMsOf(retryAfter);
  if (status === 400) return new ModelGatewayError("invalid_request", `OpenRouter rejected the request (400)${said}`, status);
  if (status === 401) {
    return keyDisabled(body) ? new ModelGatewayError("key_disabled", `The key is disabled (401)${said}`, status) : new ModelGatewayError("unauthorized", `OpenRouter refused the key (401)${said}`, status);
  }
  if (status === 402 || status === 403) {
    if (status === 403 && moderationHit(body)) return new ModelGatewayError("moderated", `The provider's moderation flagged the input (403)${said}`, status);
    const limit = limitHit(body);
    if (limit === "key") return new ModelGatewayError("budget_exhausted", `The key's dollar limit is spent (${status})${said}`, status);
    if (limit === "account") return new ModelGatewayError("account_budget_exhausted", `A workspace or guardrail budget above the key is spent (${status})${said}`, status);
    /* The in-flight budget fills and empties as running calls settle: a wait, not a top-up (OpenRouter sends Retry-After). */
    if (limit === "in_flight") return new ModelGatewayError("rate_limited", `The account's in-flight budget is full for now (${status})${said}`, status, wait);
    if (keyDisabled(body)) return new ModelGatewayError("key_disabled", `The key is disabled (${status})${said}`, status);
    if (status === 402) return new ModelGatewayError("out_of_credits", `The OpenRouter account is out of credits (402)${said}`, status);
    return new ModelGatewayError("forbidden", `OpenRouter forbade the request (403)${said}`, status);
  }
  if (status === 404) return new ModelGatewayError("not_found", `Nothing serves this: no such model, or no endpoint of the pinned providers takes these parameters (404)${said}`, status);
  if (status === 408) return new ModelGatewayError("timeout", `OpenRouter timed out (408)${said}`, status);
  if (status === 429) return new ModelGatewayError("rate_limited", `Too many requests (429)${said}`, status, wait);
  return new ModelGatewayError("provider_unavailable", `OpenRouter answered ${status}${said}`, status, wait);
}

/** A thrown fetch, read: our own timer, the caller's signal, or a connection never made. */
export function classifyThrown(error: unknown, timedOut: boolean, callerAborted: boolean): ModelGatewayError {
  if (timedOut) return new ModelGatewayError("timeout", "No answer within the call's time budget");
  if (callerAborted) return new ModelGatewayError("aborted", "The caller stopped the call");
  const message = error instanceof Error ? error.message : String(error);
  return new ModelGatewayError("network", `The request did not reach OpenRouter: ${message.slice(0, 200)}`);
}
