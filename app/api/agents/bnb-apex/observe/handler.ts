import {
  BnbApexAdapterError,
  type ApexKnownJobObservation,
} from "../../../../../lib/agent-control/adapters/bnb-apex.ts";
import {
  acquireAgentControlUpstreamReadSlot,
  consumeAgentControlRequest,
  readAgentControlJson,
} from "../../../../../lib/agent-control/http.ts";
import {
  privateNoStoreHeaders,
  rateLimitHeaders,
  type RateLimitDecision,
} from "../../../../../lib/http-control.ts";

const APEX_OBSERVE_MAX_BODY_BYTES = 1_024;
const JOB_ID = /^(0|[1-9][0-9]{0,77})$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT256_MAX = (1n << 256n) - 1n;

type KnownJobObserver = (
  reference: Readonly<{ jobId: string; txHash: string }>,
  input: Readonly<{ signal: AbortSignal }>,
) => Promise<ApexKnownJobObservation>;
type RequestConsumer = typeof consumeAgentControlRequest;
type JsonReader = typeof readAgentControlJson;
type UpstreamSlotAcquirer = typeof acquireAgentControlUpstreamReadSlot;

type BnbApexObserveHandlerDependencies = Readonly<{
  observeJob: KnownJobObserver;
  consumeRequest?: RequestConsumer;
  readJson?: JsonReader;
  acquireUpstreamSlot?: UpstreamSlotAcquirer;
}>;

function responseHeaders(
  rate: RateLimitDecision,
  extra: Readonly<Record<string, string>> = {},
) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate), ...extra };
}

function hasNoQuery(request: Request): boolean {
  try {
    return [...new URL(request.url).searchParams].length === 0;
  } catch {
    return false;
  }
}

function failure(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extraHeaders: Readonly<Record<string, string>> = {},
) {
  return Response.json(
    { error: { code, message } },
    { status, headers: responseHeaders(rate, extraHeaders) },
  );
}

function parseReference(value: unknown): { jobId: string; txHash: string } | null {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
  ) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2
    || keys[0] !== "jobId"
    || keys[1] !== "txHash"
    || typeof record.jobId !== "string"
    || typeof record.txHash !== "string"
    || !JOB_ID.test(record.jobId)
    || !TX_HASH.test(record.txHash)
  ) {
    return null;
  }

  try {
    if (BigInt(record.jobId) > UINT256_MAX) return null;
  } catch {
    return null;
  }

  return {
    jobId: record.jobId,
    txHash: record.txHash.toLowerCase(),
  };
}

function isReferenceValidationError(error: BnbApexAdapterError): boolean {
  return error.code === "APEX_JOB_ID_INVALID" || error.code === "APEX_HASH_INVALID";
}

export function createBnbApexObservePostHandler({
  observeJob,
  consumeRequest = consumeAgentControlRequest,
  readJson = readAgentControlJson,
  acquireUpstreamSlot = acquireAgentControlUpstreamReadSlot,
}: BnbApexObserveHandlerDependencies) {
  return async function handleBnbApexObservePost(request: Request) {
    const rate = consumeRequest(request.headers);
    if (!rate.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many BNB APEX observation requests. Retry after the rate-limit window.",
        rate,
      );
    }

    if (!hasNoQuery(request)) {
      return failure(
        400,
        "VALIDATION_ERROR",
        "The BNB APEX observation request is not accepted.",
        rate,
      );
    }

    const body = await readJson(request, APEX_OBSERVE_MAX_BODY_BYTES);
    if (!body.ok) {
      return failure(
        body.status,
        body.code,
        "The BNB APEX observation request is not accepted.",
        rate,
      );
    }

    const reference = parseReference(body.value);
    if (reference === null) {
      return failure(
        400,
        "VALIDATION_ERROR",
        "The BNB APEX observation request is not accepted.",
        rate,
      );
    }

    const slot = acquireUpstreamSlot();
    if (!slot.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many BNB APEX observation requests. Retry after the rate-limit window.",
        rate,
        { "Retry-After": String(slot.retryAfterSeconds) },
      );
    }

    try {
      const observation = await observeJob(reference, { signal: request.signal });
      return Response.json(
        { data: observation },
        { headers: responseHeaders(rate) },
      );
    } catch (error: unknown) {
      if (request.signal.aborted) {
        return failure(
          499,
          "REQUEST_ABORTED",
          "The BNB APEX observation request was cancelled.",
          rate,
        );
      }

      if (error instanceof BnbApexAdapterError && isReferenceValidationError(error)) {
        return failure(
          400,
          "VALIDATION_ERROR",
          "The BNB APEX observation request is not accepted.",
          rate,
        );
      }

      return failure(
        502,
        "UPSTREAM_FAILURE",
        "The BNB APEX read-only observation could not be completed.",
        rate,
      );
    } finally {
      slot.release();
    }
  };
}
