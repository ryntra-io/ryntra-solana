/**
 * `@ryntra/client` — the typed, read-only client for the Ryntra API v1.
 *
 * Everything a caller needs is here: the client itself, the five error classes
 * to branch on, the validator in case a caller wants to check a body it got
 * some other way, and the generated surface as data (the operations, the
 * schemas, the contract's error table).
 */

export { createRyntraClient, type RyntraClient, type RyntraClientOptions } from "./client.ts";
export {
  RyntraError,
  RyntraApiError,
  RyntraProtocolError,
  RyntraRouteError,
  RyntraSchemaError,
  RyntraTransportError,
  type ApiIssue,
  type RyntraErrorInput,
} from "./errors.ts";
export { createTransport, newIdempotencyKey, type FetchLike, type RequestInit, type Transport, type TransportOptions } from "./transport.ts";
export { check, describe, type Failure, type JsonSchema } from "./validate.ts";
export {
  API_HEADER,
  API_VERSION_HEADER,
  CONTRACT_MAJOR,
  CONTRACT_VERSION,
  ERRORS,
  IDEMPOTENCY_HEADER,
  OPERATIONS,
  PAGINATION,
  type ApiErrorCode,
  type OperationSpec,
  type ParameterSpec,
} from "./generated/contract.ts";
export { SCHEMAS } from "./generated/schemas.ts";
export type { OperationId, PagedOperationId, ParamsOf, ResponseOf } from "./generated/types.ts";
