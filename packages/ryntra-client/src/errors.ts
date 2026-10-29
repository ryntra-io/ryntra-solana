/**
 * Every way a read can fail, as a class a caller can branch on.
 *
 * Five classes rather than one, because the five mean different things to the
 * code that catches them and a single error with a string tag pushes that
 * distinction into the caller's regular expressions:
 *
 *   RyntraTransportError  the request never got an answer
 *   RyntraApiError        /api/v1 refused, with a stable contract code
 *   RyntraRouteError      a route outside /api/v1 refused, with its own code
 *   RyntraProtocolError   something answered, but not with an answer
 *   RyntraSchemaError     a 200 whose body is not the shape the contract states
 *
 * They share `retryable`, which is read from the contract's own error table
 * rather than guessed from the status, so «can I ask again?» has one answer in
 * one place. Nothing here ever carries a key, a signature or a transaction:
 * there is nothing in this package that could produce one.
 */

import { ERRORS, type ApiErrorCode } from "./generated/contract.ts";
import { describe, type Failure } from "./validate.ts";

export type RyntraErrorInput = Readonly<{
  message: string;
  /** The read that failed, by operation id, when the failure happened inside one. */
  operationId?: string | null;
  /** The HTTP status, or 0 when there never was one. */
  status?: number;
  retryable?: boolean;
  /** Whole seconds the server asked us to wait, from `Retry-After`. */
  retryAfterSeconds?: number | null;
}>;

export class RyntraError extends Error {
  readonly operationId: string | null;
  readonly status: number;
  /** Whether asking again could reasonably give a different answer. */
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(input: RyntraErrorInput) {
    super(input.message);
    this.name = "RyntraError";
    this.operationId = input.operationId ?? null;
    this.status = input.status ?? 0;
    this.retryable = input.retryable ?? false;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

/**
 * The request never completed: DNS, the socket, a timeout, an abort. Always
 * retryable — nothing was decided, so nothing has happened yet.
 */
export class RyntraTransportError extends RyntraError {
  constructor(input: Omit<RyntraErrorInput, "retryable" | "status">) {
    super({ ...input, status: 0, retryable: true });
    this.name = "RyntraTransportError";
  }
}

export type ApiIssue = Readonly<{ path: string; message: string; code?: string }>;

/**
 * A refusal from `/api/v1`, in the contract's one error shape. `code` is the
 * stable word to switch on; the message is for a person and may change.
 */
export class RyntraApiError extends RyntraError {
  readonly code: ApiErrorCode | string;
  /** The exact contract version the route implements, from its own header. */
  readonly contractVersion: string | null;
  /** On a refusal that names fields — `PLAN_INVALID` and its kin — one entry per field. */
  readonly issues: readonly ApiIssue[];
  /** On `UNSUPPORTED_CLIENT`: the version of the app the server will talk to. */
  readonly minimumAppVersion: string | null;

  constructor(
    input: Omit<RyntraErrorInput, "retryable"> &
      Readonly<{ code: string; contractVersion?: string | null; issues?: readonly ApiIssue[]; minimumAppVersion?: string | null }>,
  ) {
    const known = (ERRORS as Readonly<Record<string, { status: number; retryable: boolean }>>)[input.code];
    super({ ...input, retryable: known?.retryable ?? (input.status ?? 0) >= 500 });
    this.name = "RyntraApiError";
    this.code = input.code;
    this.contractVersion = input.contractVersion ?? null;
    this.issues = input.issues ?? [];
    this.minimumAppVersion = input.minimumAppVersion ?? null;
  }

  /** True when the code is one this build of the contract knows about. */
  get known(): boolean {
    return this.code in ERRORS;
  }
}

/**
 * A refusal from a route outside `/api/v1` — the markets, the stocks, the
 * predictions, the public payment page. Its codes are its own
 * (`MARKETS_RATE_LIMITED`, `UNKNOWN_ASSET`, `CANDLES_NO_POOL`), not the v1
 * union, which is why it is not a `RyntraApiError` with a borrowed code.
 */
export class RyntraRouteError extends RyntraError {
  readonly code: string;
  /** The refusal exactly as the route sent it. */
  readonly details: Readonly<Record<string, unknown>> | null;

  constructor(input: Omit<RyntraErrorInput, "retryable"> & Readonly<{ code: string; details?: Readonly<Record<string, unknown>> | null }>) {
    super({ ...input, retryable: input.status === 429 || (input.status ?? 0) >= 500 });
    this.name = "RyntraRouteError";
    this.code = input.code;
    this.details = input.details ?? null;
  }
}

/** Something answered, but not with JSON, or not with an error the contract describes. */
export class RyntraProtocolError extends RyntraError {
  /** The first of the body, for a log. Never the whole thing. */
  readonly body: string;

  constructor(input: Omit<RyntraErrorInput, "retryable"> & Readonly<{ body?: string }>) {
    super({ ...input, retryable: (input.status ?? 0) >= 500 });
    this.name = "RyntraProtocolError";
    this.body = (input.body ?? "").slice(0, 400);
  }
}

/**
 * A 200 that is not the answer the contract promises.
 *
 * Never retryable: the server did what it meant to do, and it disagrees with
 * the document. Asking again gets the same answer, so the useful move is to
 * read `failures` and say so — which is the whole reason the client validates
 * instead of casting.
 */
export class RyntraSchemaError extends RyntraError {
  /** The response schema the answer was read against, by its contract name. */
  readonly schema: string;
  readonly failures: readonly Failure[];

  constructor(input: Omit<RyntraErrorInput, "retryable" | "message"> & Readonly<{ schema: string; failures: readonly Failure[] }>) {
    super({
      ...input,
      retryable: false,
      message: `the answer is not a ${input.schema} the contract would recognise — ${describe(input.failures)}`,
    });
    this.name = "RyntraSchemaError";
    this.schema = input.schema;
    this.failures = input.failures;
  }
}
