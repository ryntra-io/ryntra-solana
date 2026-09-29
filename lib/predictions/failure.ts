/**
 * How the prediction surfaces fail, in one vocabulary.
 *
 * Every route answers `{ error: { code, message } }` with the status the code
 * maps to; every page state that shows a failure names the code's meaning in
 * the person's language, never the provider's text. A provider outage is a
 * state, not an exception: `PROVIDER_UNAVAILABLE` and `RATE_LIMITED` are what
 * the person sees as *the market feed is unavailable right now*, while
 * `NOT_LINKED`, `LINK_UNAVAILABLE` and `SESSION_EXPIRED` are what the paper
 * account says before it can act.
 */

export const PREDICTION_FAILURE_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  /** The paper account is not linked to this wallet yet — one wallet signature away. */
  "NOT_LINKED",
  /** The link cannot be made on this deployment (no session secret, no durable store). */
  "LINK_UNAVAILABLE",
  /** The provider session behind the account no longer refreshes — sign again. */
  "SESSION_EXPIRED",
  /** The wallet that signed is not the wallet the Ryntra session proved. */
  "WALLET_MISMATCH",
  /** The provider refused the signature or the nonce. */
  "SIGNATURE_INVALID",
  /** A quote that expired or a route the provider could not fill. */
  "QUOTE_UNAVAILABLE",
  "QUOTE_EXPIRED",
  /** The paper order was refused by the provider, with its reason. */
  "ORDER_REFUSED",
  "PLAN_INVALID",
  "PLAN_NOT_FOUND",
  "PLAN_VERSION_CONFLICT",
  "PLAN_STATE_REFUSED",
  "UNAVAILABLE",
] as const;

export type PredictionFailureCode = (typeof PREDICTION_FAILURE_CODES)[number];

export const PREDICTION_FAILURE_STATUS: Readonly<Record<PredictionFailureCode, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  NOT_LINKED: 409,
  LINK_UNAVAILABLE: 503,
  SESSION_EXPIRED: 401,
  WALLET_MISMATCH: 403,
  SIGNATURE_INVALID: 401,
  QUOTE_UNAVAILABLE: 422,
  QUOTE_EXPIRED: 409,
  ORDER_REFUSED: 422,
  PLAN_INVALID: 400,
  PLAN_NOT_FOUND: 404,
  PLAN_VERSION_CONFLICT: 409,
  PLAN_STATE_REFUSED: 409,
  UNAVAILABLE: 503,
};

export type PredictionFailure = Readonly<{
  ok: false;
  code: PredictionFailureCode;
  message: string;
  /** Field-level detail for `VALIDATION_ERROR` / `PLAN_INVALID`. */
  issues?: readonly Readonly<{ path: string; message: string }>[];
  /** When the provider says how long to wait (`RATE_LIMITED`), seconds. */
  retryAfterSeconds?: number;
}>;

export function failure(code: PredictionFailureCode, message: string, extra: Partial<Omit<PredictionFailure, "ok" | "code" | "message">> = {}): PredictionFailure {
  return { ok: false, code, message, ...extra };
}

/** At most this many refused fields travel in an error, each bounded — the v1 routes' own cap (contract 1.11.0). */
export const FAILURE_ISSUE_LIMIT = 32;
const FAILURE_MESSAGE_LIMIT = 1_000;
const ISSUE_PATH_LIMIT = 256;
const ISSUE_MESSAGE_LIMIT = 512;

/**
 * The error body a prediction route answers — `{ error: { code, message, issues? } }`.
 *
 * Bounded (contract 1.11.0): until then the list was
 * every issue the validator raised, whole, so a refused 32 KB plan body drew
 * tens of thousands of issues (43,672 measured) and a message could quote a
 * 32 KB key; the answer to a malformed request weighed more than the request.
 * The first thirty-two refused fields name what to fix; the rest add nothing.
 */
export function failureBody(f: PredictionFailure): Readonly<{ error: Readonly<{ code: PredictionFailureCode; message: string; issues?: readonly Readonly<{ path: string; message: string }>[] }> }> {
  const issues = f.issues && f.issues.length > 0
    ? f.issues.slice(0, FAILURE_ISSUE_LIMIT).map((issue) => ({ path: issue.path.slice(0, ISSUE_PATH_LIMIT), message: issue.message.slice(0, ISSUE_MESSAGE_LIMIT) || "Refused." }))
    : null;
  return { error: { code: f.code, message: f.message.slice(0, FAILURE_MESSAGE_LIMIT) || f.code, ...(issues ? { issues } : {}) } };
}

export function isPredictionFailure(value: unknown): value is PredictionFailure {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false && typeof (value as { code?: unknown }).code === "string";
}

/**
 * What a thrown provider error means for the person. The SDK's `AggApiError`
 * carries the HTTP status; a network failure carries none. The provider's
 * own message is kept for the log line, never shown as the product's words.
 */
export function classifyProviderError(error: unknown): PredictionFailure {
  const status = typeof (error as { status?: unknown })?.status === "number" ? ((error as { status: number }).status as number) : null;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (status === 429) {
    const retry = Number((error as { retryAfter?: unknown })?.retryAfter);
    return failure("RATE_LIMITED", "The market feed is busy; try again in a moment.", Number.isFinite(retry) && retry > 0 ? { retryAfterSeconds: retry } : {});
  }
  if (status === 401) return failure("SESSION_EXPIRED", "The paper account's session expired; sign with the wallet again.");
  if (status === 403) return failure("FORBIDDEN", "The provider refused this request for this account.");
  if (status === 404) return failure("NOT_FOUND", "The provider has no such market.");
  if (status !== null && status >= 400 && status < 500) return failure("VALIDATION_ERROR", message || "The provider refused the request.");
  return failure("PROVIDER_UNAVAILABLE", "The market feed is unavailable right now.");
}
