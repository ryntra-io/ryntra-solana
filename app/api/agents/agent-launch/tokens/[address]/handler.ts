import {
  AgentLaunchAdapterError,
  type AgentLaunchTokenDetailObservation,
} from "../../../../../../lib/agent-control/adapters/agent-launch.ts";
import {
  acquireAgentControlUpstreamReadSlot,
  consumeAgentControlRequest,
} from "../../../../../../lib/agent-control/http.ts";
import {
  privateNoStoreHeaders,
  rateLimitHeaders,
  type RateLimitDecision,
} from "../../../../../../lib/http-control.ts";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

type TokenDetailReader = (
  address: string,
  input: Readonly<{ signal: AbortSignal }>,
) => Promise<AgentLaunchTokenDetailObservation>;
type RequestConsumer = typeof consumeAgentControlRequest;
type UpstreamSlotAcquirer = typeof acquireAgentControlUpstreamReadSlot;
type RouteContext = Readonly<{ params: Promise<{ address: string }> }>;

type AgentLaunchTokenDetailHandlerDependencies = Readonly<{
  fetchToken: TokenDetailReader;
  consumeRequest?: RequestConsumer;
  acquireUpstreamSlot?: UpstreamSlotAcquirer;
}>;

function responseHeaders(
  rate: RateLimitDecision,
  extra: Readonly<Record<string, string>> = {},
) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate), ...extra };
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

function hasNoQuery(request: Request): boolean {
  try {
    return [...new URL(request.url).searchParams].length === 0;
  } catch {
    return false;
  }
}

async function readAddress(context: RouteContext): Promise<string | null> {
  try {
    const params = await context.params;
    if (
      params === null
      || typeof params !== "object"
      || Object.keys(params).length !== 1
      || typeof params.address !== "string"
      || !EVM_ADDRESS.test(params.address)
    ) {
      return null;
    }
    return params.address.toLowerCase();
  } catch {
    return null;
  }
}

export function createAgentLaunchTokenDetailGetHandler({
  fetchToken,
  consumeRequest = consumeAgentControlRequest,
  acquireUpstreamSlot = acquireAgentControlUpstreamReadSlot,
}: AgentLaunchTokenDetailHandlerDependencies) {
  return async function handleAgentLaunchTokenDetailGet(
    request: Request,
    context: RouteContext,
  ) {
    const rate = consumeRequest(request.headers);
    if (!rate.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many Agent Launch token requests. Retry after the rate-limit window.",
        rate,
      );
    }

    const address = hasNoQuery(request) ? await readAddress(context) : null;
    if (address === null) {
      return failure(
        400,
        "VALIDATION_ERROR",
        "The Agent Launch token-detail request is not accepted.",
        rate,
      );
    }

    const slot = acquireUpstreamSlot();
    if (!slot.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many Agent Launch token requests. Retry after the rate-limit window.",
        rate,
        { "Retry-After": String(slot.retryAfterSeconds) },
      );
    }

    try {
      const observation = await fetchToken(address, { signal: request.signal });
      return Response.json(
        { data: observation },
        { headers: responseHeaders(rate) },
      );
    } catch (error: unknown) {
      if (request.signal.aborted) {
        return failure(
          499,
          "REQUEST_ABORTED",
          "The Agent Launch token-detail request was cancelled.",
          rate,
        );
      }

      if (
        error instanceof AgentLaunchAdapterError
        && error.code === "AGENT_LAUNCH_ADDRESS_INVALID"
      ) {
        return failure(
          400,
          "VALIDATION_ERROR",
          "The Agent Launch token-detail request is not accepted.",
          rate,
        );
      }

      return failure(
        502,
        "UPSTREAM_FAILURE",
        "The Agent Launch token-detail read could not be completed.",
        rate,
      );
    } finally {
      slot.release();
    }
  };
}
